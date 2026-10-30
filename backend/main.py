import os
import json
import sqlite3
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
    skill_name: str
    score_percentage: int
    correct_count: int
    total_questions: int = 10
    authenticity_hash: str

# API ROUTES

@app.get("/")
def read_root():
    return {"status": "Online", "message": "Synqora Engine Active"}

# 1. Fetch Dynamic AI Question Sets
@app.get("/api/questions")
def fetch_questions(skill: str = Query("Python"), round: int = Query(1), user_id: int = Query(1)):
    try:
        questions = get_live_questions(skill_name=skill, round_num=round)
        return questions
    except Exception as e:
        return get_fallback_questions(skill, round)

# 2. Save Test Results to Database
@app.post("/api/save-assessment")
def save_assessment_result(result: AssessmentResultSave):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        status = "PASSED" if result.score_percentage >= 80 else "FAILED"
        
        cursor.execute("""
            INSERT INTO assessments (user_id, skill_name, score_percentage, status, correct_count, total_questions, authenticity_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (result.user_id, result.skill_name, result.score_percentage, status, result.correct_count, result.total_questions, result.authenticity_hash))
        
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Assessment recorded in DB!", "hash": result.authenticity_hash}
    except sqlite3.IntegrityError:
        return {"status": "success", "message": "Record already verified."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save record: {str(e)}")

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