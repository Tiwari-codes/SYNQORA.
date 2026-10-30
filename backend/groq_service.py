import os
import json
import random
import hashlib
import re
from groq import Groq
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

load_dotenv()

# Initialize Flask App
app = Flask(__name__)
CORS(app)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
client = None
if GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as init_err:
        print(f"[WARN] Groq client initialization failed: {init_err}")
        client = None

def generate_hash(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def clean_and_shuffle_questions(questions_list):
    """Sanitizes question options, formats newline literals, and shuffles question order."""
    if not isinstance(questions_list, list):
        return questions_list

    sanitized = []
    for q in questions_list:
        if isinstance(q, dict):
            if "question" in q and isinstance(q["question"], str):
                q["question"] = q["question"].replace("\\n", "\n")

            raw_options = q.get("options", [])
            if isinstance(raw_options, list):
                cleaned = [
                    str(opt).replace("\\n", "\n").strip() 
                    for opt in raw_options 
                    if str(opt).strip() not in ["correct_answer", ":", "A", "B", "C", "D", "options", "type", "company_tag"]
                ]
                q["options"] = cleaned
            sanitized.append(q)
        
    random.shuffle(sanitized)
    return sanitized

def get_live_questions(skill_name: str, round_num: int = 1, previous_hashes: list = None):
    if previous_hashes is None:
        previous_hashes = []

    prompt = f"""
    You are Synqora's AI Assessment Engine.
    Generate 10 fresh, non-repeating technical assessment questions for the skill: '{skill_name}' (Round {round_num}).

    STRICT QUESTION TYPE DISTRIBUTION (MUST BE SHUFFLED & MIXED):
    - 4 Standard MCQs (4 options starting with A), B), C), D))
    - 2 True / False questions (options: ["A) TRUE", "B) FALSE"])
    - 2 Manual Fill-In / Value Output prediction questions (options: [])
    - 2 Debugging / Spot the Bug scenarios (4 options starting with A), B), C), D))

    IMPORTANT: Return ONLY a valid JSON object with a root key "questions" containing the array of 10 questions. No extra text, no markdown blocks if possible.

    REQUIRED JSON SCHEMA FORMAT:
    {{
      "questions": [
        {{
          "id": 1,
          "type": "Spot the Bug",
          "company_tag": "Microsoft | 2026",
          "question": "Identify the bug in the following snippet:\\ndef solve(arr):\\n    return arr.sort()",
          "options": ["A) sort() modifies in-place and returns None", "B) SyntaxError on line 1", "C) Memory limit exceeded", "D) Type mismatch"],
          "correct_answer": "A"
        }}
      ]
    }}
    """

    if not client or not GROQ_API_KEY:
        print("[WARN] Groq API Key Missing! Serving Fallback Questions.")
        return get_fallback_questions(skill_name, round_num)

    try:
        available_models = []
        try:
            models_response = client.models.list()
            ignored_keywords = ['embed', 'whisper', 'guard', 'orpheus', 'safeguard', 'allam']
            available_models = [
                m.id for m in models_response.data 
                if not any(kw in m.id.lower() for kw in ignored_keywords)
            ]
            print(f"[INFO] Filtered active chat models: {available_models}")
        except Exception as e:
            print(f"[WARN] Could not fetch dynamic model list ({e}), using default model candidate list.")

        default_candidates = [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "llama-3.1-70b-versatile",
            "mixtral-8x7b-32768",
            "gemma2-9b-it"
        ]
        for candidate in default_candidates:
            if candidate not in available_models:
                available_models.append(candidate)

        for model_name in available_models:
            try:
                response = client.chat.completions.create(
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a specialized JSON generation engine. Output strictly valid JSON."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    model=model_name,
                    temperature=0.4,
                    max_tokens=4096
                )

                raw_content = response.choices[0].message.content if hasattr(response, 'choices') else ""
                
                if not raw_content or not raw_content.strip():
                    print(f"[WARN] Model '{model_name}' returned empty response. Trying next...")
                    continue

                raw_content = re.sub(r'<think>.*?</think>', '', raw_content, flags=re.DOTALL).strip()
                if "```json" in raw_content:
                    raw_content = raw_content.split("```json")[1].split("```")[0].strip()
                elif "```" in raw_content:
                    raw_content = raw_content.split("```")[1].split("```")[0].strip()

                json_match = re.search(r'\{.*\}', raw_content, re.DOTALL)
                if json_match:
                    raw_content = json_match.group(0)

                data = json.loads(raw_content)

                print(f"[SUCCESS] Successfully generated live AI questions using model: {model_name}")

                if isinstance(data, dict):
                    for key in ["questions", "data", "results", "quiz"]:
                        if key in data and isinstance(data[key], list) and len(data[key]) >= 5:
                            return clean_and_shuffle_questions(data[key])
                    res = list(data.values())[0]
                    return clean_and_shuffle_questions(res) if isinstance(res, list) else get_fallback_questions(skill_name, round_num)

                if isinstance(data, list):
                    return clean_and_shuffle_questions(data)

            except Exception as e:
                print(f"[WARN] Model '{model_name}' failed ({e}). Trying next...")

        print("[WARN] All AI models failed/exhausted. Serving 10-question fallback suite.")
        return get_fallback_questions(skill_name, round_num)
    except Exception as outer_err:
        print(f"[WARN] Unexpected error in get_live_questions ({outer_err}). Serving Fallback Questions.")
        return get_fallback_questions(skill_name, round_num)

def get_fallback_questions(skill_name: str, round_num: int):
    fallback_suite = [
        {
            "id": 1,
            "type": "Standard MCQ",
            "company_tag": "Amazon | 2026",
            "question": f"Which core data structure or paradigm in {skill_name} provides O(1) average time complexity for key-based lookups?",
            "options": ["A) Hash Table / Dictionary", "B) Linear Unsorted Array", "C) Singly Linked List", "D) FIFO Queue"],
            "correct_answer": "A"
        },
        {
            "id": 2,
            "type": "Manual Fill-In",
            "company_tag": "Google | 2025",
            "question": f"What is the average time complexity (in Big-O notation, e.g., O(1) or O(n)) for direct hash-indexed lookup in {skill_name}?",
            "options": [],
            "correct_answer": "O(1)"
        },
        {
            "id": 3,
            "type": "True / False",
            "company_tag": "Microsoft | 2026",
            "question": f"True or False: In {skill_name}, immutable primitive or tuple-like objects allow in-place memory mutation after creation.",
            "options": ["A) TRUE", "B) FALSE"],
            "correct_answer": "B"
        },
        {
            "id": 4,
            "type": "Spot the Bug",
            "company_tag": "Atlassian | 2025",
            "question": f"Identify the error when accessing the 4th element in a 0-indexed collection of size 3 in {skill_name}:\n\nitems = [10, 20, 30]\nval = items[3]",
            "options": ["A) IndexError / Out of Bounds", "B) SyntaxError", "C) NullPointerException on line 1", "D) StackOverflowError"],
            "correct_answer": "A"
        },
        {
            "id": 5,
            "type": "Standard MCQ",
            "company_tag": "Uber | 2026",
            "question": f"When optimizing {skill_name} applications for high concurrency, which technique prevents race conditions on shared state?",
            "options": ["A) Busy waiting without locks", "B) Mutex Locks / Atomic Operations", "C) Global unguarded variables", "D) Disabling garbage collection"],
            "correct_answer": "B"
        },
        {
            "id": 6,
            "type": "Standard MCQ",
            "company_tag": "Flipkart | 2025",
            "question": f"What is the worst-case time complexity of Binary Search on a sorted array of N elements in {skill_name}?",
            "options": ["A) O(N)", "B) O(N log N)", "C) O(log N)", "D) O(1)"],
            "correct_answer": "C"
        },
        {
            "id": 7,
            "type": "True / False",
            "company_tag": "Stripe | 2026",
            "question": f"True or False: Recursion without a valid termination base case leads to a Stack Overflow / RecursionError in {skill_name}.",
            "options": ["A) TRUE", "B) FALSE"],
            "correct_answer": "A"
        },
        {
            "id": 8,
            "type": "Spot the Bug",
            "company_tag": "Zomato | 2025",
            "question": f"What is the logical issue in the following loop condition?\n\ncount = 10\nwhile count > 0:\n    count += 1",
            "options": ["A) Infinite loop because count increases instead of decreasing", "B) SyntaxError in while header", "C) Variable count is undefined", "D) Loop executes zero times"],
            "correct_answer": "A"
        },
        {
            "id": 9,
            "type": "Manual Fill-In",
            "company_tag": "TCS Digital | 2026",
            "question": f"Which HTTP status code number represents 'OK / Success' in RESTful APIs built with {skill_name}?",
            "options": [],
            "correct_answer": "200"
        },
        {
            "id": 10,
            "type": "Standard MCQ",
            "company_tag": "Razorpay | 2026",
            "question": f"Which principle of software design in {skill_name} states that a class or module should have only one reason to change?",
            "options": ["A) Single Responsibility Principle (SRP)", "B) Liskov Substitution Principle", "C) premature Optimization", "D) Tight Coupling"],
            "correct_answer": "A"
        }
    ]

    random.shuffle(fallback_suite)
    return fallback_suite

# API Routes for Flask Application
@app.route("/", methods=["GET"])
def health_check():
    return jsonify({"status": "active", "service": "Synqora AI Assessment Microservice"})

@app.route("/generate-questions", methods=["POST"])
def generate():
    data = request.get_json() or {}
    skill = data.get("skill", "General Software Engineering")
    round_num = data.get("round", 1)
    questions = get_live_questions(skill, round_num)
    return jsonify({"questions": questions})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)