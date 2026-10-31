import os
import json
import sqlite3
import hashlib
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq_service import get_live_questions, get_fallback_questions

app = FastAPI(title="Synqora AI Assessment Protocol Core Engine")

# CORS Configuration (Allows Frontend to connect smoothly)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SQLite Database Setup
DB_PATH = os.path.join(os.path.dirname(__file__), "synqora.db")

def init_sqlite_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 1,
        skill_name TEXT NOT NULL,
        score_percentage INTEGER NOT NULL,
        status TEXT NOT NULL,
        correct_count INTEGER NOT NULL,
        total_questions INTEGER DEFAULT 10,
        authenticity_hash TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    conn.commit()
    conn.close()

init_sqlite_db()

# Request Body Schema
class AssessmentResultSave(BaseModel):
    user_id: int = 1
    skill_name: str = "General Technical"
    skill: str = None
    score_percentage: int = 0
    score: int = None
    correct_count: int = 0
    total_questions: int = 10
    authenticity_hash: str = None
    hash: str = None
    passport_hash: str = None

# API ROUTES

@app.get("/")
def read_root():
    return {"status": "Online", "service": "Synqora AI Assessment Protocol Core Engine"}

# 1. Fetch Dynamic AI Question Sets
@app.get("/api/questions")
def fetch_questions(skill: str = Query("Python"), round: int = Query(1), user_id: int = Query(1)):
    try:
        questions = get_live_questions(skill_name=skill, round_num=round)
        return questions
    except Exception as e:
        print(f"[WARN] Error fetching live questions ({e}), loading fallback questions.")
        return get_fallback_questions(skill, round)

# 2. Save Test Results to Database & Sync with Node.js / MySQL Profile
@app.post("/api/save-assessment")
def save_assessment_result(result: AssessmentResultSave):
    target_skill = result.skill or result.skill_name or "General Technical"
    target_score = result.score if result.score is not None else result.score_percentage
    target_hash = result.passport_hash or result.hash or result.authenticity_hash
    if not target_hash:
        target_hash = f"SYNQ-0x{hashlib.sha256(os.urandom(16)).hexdigest()[:12].upper()}"

    status = "PASSED" if target_score >= 80 else "FAILED"

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO assessments (user_id, skill_name, score_percentage, status, correct_count, total_questions, authenticity_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (result.user_id, target_skill, target_score, status, result.correct_count, result.total_questions, target_hash))
        
        conn.commit()
        conn.close()
    except sqlite3.IntegrityError:
        print(f"[INFO] Assessment record with hash {target_hash} already verified in SQLite.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save record: {str(e)}")

    # Node.js profile score update sync
    try:
        import urllib.request
        sync_payload = json.dumps({
            "user_id": result.user_id,
            "skill": target_skill,
            "score": target_score,
            "hash": target_hash
        }).encode('utf-8')
        req = urllib.request.Request(
            "http://127.0.0.1:5000/api/internal/sync-assessment",
            data=sync_payload,
            headers={'Content-Type': 'application/json'}
        )
        urllib.request.urlopen(req, timeout=2)
        print(f"[SYNC-SUCCESS] Node.js profile sync completed for user {result.user_id}")
    except Exception as e:
        print(f"[SYNC-WARN] Node profile sync bypassed: {e}")

    return {"status": "success", "message": "Assessment recorded in DB!", "hash": target_hash}

# 3. Cryptographic Passport Hash Verification Route
@app.get("/api/verify-passport/{hash_key}")
def verify_passport(hash_key: str):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM assessments WHERE authenticity_hash = ?", (hash_key,))
    record = cursor.fetchone()
    conn.close()
    
    if record:
        return {"verified": True, "data": dict(record)}
    else:
        return {"verified": False, "message": "Invalid or Tampered Passport Hash Key"}
