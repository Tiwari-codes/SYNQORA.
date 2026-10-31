import os
import json
import random
import hashlib
import re
from groq import Groq
from dotenv import load_dotenv

# Load environment variables reliably from backend directory
env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
client = None
if GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY, timeout=15.0)
    except Exception as init_err:
        print(f"[WARN] Groq client initialization failed: {init_err}")
        client = None

def generate_hash(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def normalize_and_ensure_options(q, idx=1):
    """Guarantees every question dict has id, type, question, options (or [] for Manual Fill-In), and correct_answer."""
    if not isinstance(q, dict):
        return None
    
    question_text = str(q.get("question", "")).strip()
    if not question_text:
        return None
    
    raw_type = str(q.get("type", "Standard MCQ")).strip()
    raw_options = q.get("options", [])
    if isinstance(raw_options, dict):
        raw_options = list(raw_options.values())
    elif not isinstance(raw_options, list):
        raw_options = []
    
    clean_opts = [str(o).replace("\\n", "\n").strip() for o in raw_options if str(o).strip()]
    letters = ["A", "B", "C", "D"]

    # 1. Manual Fill-In
    if any(k in raw_type.lower() for k in ["manual", "fill-in", "fill in", "filling", "output prediction"]):
        q["type"] = "Manual Fill-In"
        q["options"] = []
        raw_ans = str(q.get("correct_answer") or q.get("answer") or "O(1)").strip()
        q["correct_answer"] = raw_ans
        q["id"] = idx
        q["company_tag"] = q.get("company_tag") or "Tech Screening | 2026"
        q["question"] = question_text
        return q

    # 2. True / False
    if "true" in raw_type.lower() or "false" in raw_type.lower() or "boolean" in raw_type.lower() or (
        len(clean_opts) == 2 and any("true" in o.lower() for o in clean_opts)
    ):
        q["type"] = "True / False"
        q["options"] = ["A) TRUE", "B) FALSE"]
        raw_ans = str(q.get("correct_answer") or q.get("answer") or "A").strip().upper()
        if raw_ans in ["TRUE", "T"]:
            q["correct_answer"] = "A"
        elif raw_ans in ["FALSE", "F"]:
            q["correct_answer"] = "B"
        elif raw_ans and raw_ans[0] in ["A", "B"]:
            q["correct_answer"] = raw_ans[0]
        else:
            q["correct_answer"] = "A"
        q["id"] = idx
        q["company_tag"] = q.get("company_tag") or "Tech Screening | 2026"
        q["question"] = question_text
        return q

    # 3. Spot the Bug / Error Finder
    if "bug" in raw_type.lower() or "error" in raw_type.lower() or "debug" in raw_type.lower():
        q["type"] = "Spot the Bug"
    # 4. Complete the Statement
    elif "complete" in raw_type.lower() or "statement" in raw_type.lower():
        q["type"] = "Complete the Statement"
    # 5. Standard MCQ
    else:
        q["type"] = "Standard MCQ"

    # Format options with A), B), C), D) prefixes
    formatted_opts = []
    for opt_idx, opt in enumerate(clean_opts[:4]):
        match = re.match(r'^[A-D][\)\.\:\-]\s*', opt, re.IGNORECASE)
        if match:
            letter = opt[0].upper()
            text = opt[match.end():].strip()
            formatted_opts.append(f"{letter}) {text}")
        else:
            prefix = letters[opt_idx] if opt_idx < 4 else chr(65 + opt_idx)
            formatted_opts.append(f"{prefix}) {opt}")

    # Fallback options if missing
    if len(formatted_opts) < 2:
        ans_val = str(q.get("correct_answer") or q.get("answer") or "Optimal Solution").strip()
        formatted_opts = [
            f"A) {ans_val}",
            "B) In-place reference mutation",
            "C) SyntaxError / TypeError",
            "D) Out of Memory / Timeout"
        ]
    elif len(formatted_opts) == 3:
        formatted_opts.append("D) None of the above")

    q["id"] = idx
    q["company_tag"] = q.get("company_tag") or "Tech Screening | 2026"
    q["question"] = question_text
    q["options"] = formatted_opts

    # Determine correct_answer as A, B, C, or D
    raw_ans = str(q.get("correct_answer") or q.get("answer") or "A").strip()
    found_letter = None
    for opt in formatted_opts:
        opt_letter = opt[0].upper()
        opt_body = opt[2:].strip().lower()
        if raw_ans.lower() == opt_letter.lower() or raw_ans.lower() == opt_body:
            found_letter = opt_letter
            break

    if found_letter:
        q["correct_answer"] = found_letter
    elif raw_ans and raw_ans[0].upper() in ["A", "B", "C", "D"]:
        q["correct_answer"] = raw_ans[0].upper()
    else:
        q["correct_answer"] = "A"

    return q

def clean_and_shuffle_questions(questions_list, skill_name="General"):
    """Sanitizes questions, preserves all distinct question types, and ensures 10 questions."""
    if not isinstance(questions_list, list):
        return get_fallback_questions(skill_name)

    normalized = []
    for idx, item in enumerate(questions_list, 1):
        clean_item = normalize_and_ensure_options(item, idx)
        if clean_item:
            normalized.append(clean_item)

    # If less than 10 questions, pad from fallback
    if len(normalized) < 10:
        fallback = get_fallback_questions(skill_name)
        for fb_item in fallback:
            if len(normalized) >= 10:
                break
            if not any(fb_item["question"] == n["question"] for n in normalized):
                fb_item["id"] = len(normalized) + 1
                normalized.append(fb_item)

    # Re-index 1..10
    for idx, item in enumerate(normalized[:10], 1):
        item["id"] = idx

    return normalized[:10]

def get_live_questions(skill_name: str, round_num: int = 1, previous_hashes: list = None):
    global client, GROQ_API_KEY
    if previous_hashes is None:
        previous_hashes = []

    # Refresh API key if needed
    if not GROQ_API_KEY:
        load_dotenv(dotenv_path=env_path)
        load_dotenv()
        GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
        if GROQ_API_KEY:
            try:
                client = Groq(api_key=GROQ_API_KEY, timeout=15.0)
            except Exception as e:
                print(f"[WARN] Groq init error: {e}")

    prompt = f"""
    You are Synqora's AI Assessment Engine.
    Generate exactly 10 fresh, non-repeating technical assessment questions for the skill: '{skill_name}' (Round {round_num}).

    YOU MUST GENERATE A BALANCED MIX OF 5 DISTINCT QUESTION TYPES:
    1. "Standard MCQ" (2 questions) -> 4 options starting with A), B), C), D)
    2. "True / False" (2 questions) -> options: ["A) TRUE", "B) FALSE"]
    3. "Spot the Bug" (2 questions) -> Identify the error or bug in a code snippet. 4 options A), B), C), D)
    4. "Complete the Statement" (2 questions) -> Complete code or definition with missing token represented by '____'. 4 options A), B), C), D)
    5. "Manual Fill-In" (2 questions) -> Predict the exact output value, keyword, or Big-O complexity. options: [], correct_answer: exact string (e.g. "O(1)", "512", "None", "200")

    CRITICAL RULES:
    - Output strictly valid JSON object with root key "questions".
    - "type" MUST be one of: "Standard MCQ", "True / False", "Spot the Bug", "Complete the Statement", "Manual Fill-In".
    - For "Manual Fill-In", "options" MUST be []. For all other 4 types, "options" must have 2 or 4 options.
    - Escape code newlines as \\n.

    JSON FORMAT EXAMPLE:
    {{
      "questions": [
        {{
          "id": 1,
          "type": "Standard MCQ",
          "company_tag": "Amazon | 2026",
          "question": "Which core data structure provides O(1) average lookup?",
          "options": ["A) Hash Table", "B) Array", "C) Linked List", "D) Stack"],
          "correct_answer": "A"
        }},
        {{
          "id": 2,
          "type": "True / False",
          "company_tag": "Google | 2026",
          "question": "In Python, strings are immutable primitive objects.",
          "options": ["A) TRUE", "B) FALSE"],
          "correct_answer": "A"
        }},
        {{
          "id": 3,
          "type": "Spot the Bug",
          "company_tag": "Microsoft | 2026",
          "question": "Identify the bug in this function:\\ndef add(a, b):\\n    return a - b",
          "options": ["A) Subtracts instead of adds", "B) SyntaxError on line 1", "C) Missing arguments", "D) Infinite loop"],
          "correct_answer": "A"
        }},
        {{
          "id": 4,
          "type": "Complete the Statement",
          "company_tag": "Atlassian | 2026",
          "question": "To create a generator function in Python, use the ____ keyword instead of return.",
          "options": ["A) yield", "B) produce", "C) emit", "D) iterate"],
          "correct_answer": "A"
        }},
        {{
          "id": 5,
          "type": "Manual Fill-In",
          "company_tag": "Uber | 2026",
          "question": "What is the exact output of: print(2 ** 3 ** 2)?",
          "options": [],
          "correct_answer": "512"
        }}
      ]
    }}
    """

    if not client or not GROQ_API_KEY:
        print("[WARN] Groq API Key Missing! Serving Fallback Questions.")
        return get_fallback_questions(skill_name, round_num)

    try:
        available_models = [
            "openai/gpt-oss-20b",
            "openai/gpt-oss-120b",
            "qwen/qwen3.8-27b"
        ]

        for model_name in available_models:
            try:
                response = client.chat.completions.create(
                    messages=[
                        {
                            "role": "system",
                            "content": "You are Synqora's specialized AI Assessment Generator. Output strictly raw JSON with root key 'questions'. Include all requested question types: Standard MCQ, True / False, Spot the Bug, Complete the Statement, and Manual Fill-In."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    model=model_name,
                    temperature=0.3,
                    max_tokens=2400
                )

                raw_content = response.choices[0].message.content.strip() if hasattr(response, 'choices') else ""
                
                if not raw_content:
                    print(f"[WARN] Model '{model_name}' returned empty response. Trying next...")
                    continue

                raw_content = re.sub(r'<think>.*?</think>', '', raw_content, flags=re.DOTALL).strip()
                clean_json_str = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_content, flags=re.MULTILINE).strip()

                if "```json" in clean_json_str:
                    clean_json_str = clean_json_str.split("```json")[1].split("```")[0].strip()
                elif "```" in clean_json_str:
                    clean_json_str = clean_json_str.split("```")[1].split("```")[0].strip()

                json_match = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])', clean_json_str)
                if json_match:
                    clean_json_str = json_match.group(0).strip()

                try:
                    questions_data = json.loads(clean_json_str, strict=False)
                except Exception:
                    # Clean unescaped newlines inside strings and trailing commas
                    cleaned = re.sub(r'(?<!\\)\r?\n', r'\\n', clean_json_str)
                    cleaned = re.sub(r',\s*([\]\}])', r'\1', cleaned)
                    try:
                        questions_data = json.loads(cleaned, strict=False)
                    except Exception:
                        questions_data = {}

                # Extract questions array
                extracted_list = None
                if isinstance(questions_data, dict):
                    for key in ["questions", "data", "results", "quiz"]:
                        if key in questions_data and isinstance(questions_data[key], list) and len(questions_data[key]) >= 3:
                            extracted_list = questions_data[key]
                            break
                    if not extracted_list and len(questions_data.values()) > 0:
                        first_val = list(questions_data.values())[0]
                        if isinstance(first_val, list) and len(first_val) >= 3:
                            extracted_list = first_val
                elif isinstance(questions_data, list):
                    extracted_list = questions_data

                if extracted_list and len(extracted_list) >= 3:
                    final_questions = clean_and_shuffle_questions(extracted_list, skill_name)
                    print(f"[SUCCESS] Generated {len(final_questions)} diverse live AI questions via {model_name}")
                    return final_questions
                else:
                    print(f"[WARN] Model '{model_name}' returned incomplete list. Trying next model...")

            except Exception as e:
                print(f"[WARN] Model '{model_name}' attempt failed: {e}. Trying next...")

        print("[WARN] All AI models exhausted. Serving diverse fallback suite.")
        return get_fallback_questions(skill_name, round_num)
    except Exception as outer_err:
        print(f"[WARN] Error in get_live_questions ({outer_err}). Serving Fallback Questions.")
        return get_fallback_questions(skill_name, round_num)

def get_fallback_questions(skill_name: str, round_num: int = 1):
    fallback_suite = [
        {
            "id": 1,
            "type": "Standard MCQ",
            "company_tag": "Amazon | 2026",
            "question": f"Which core data structure in {skill_name} provides O(1) average time complexity for key-based lookups?",
            "options": ["A) Hash Table / Dictionary", "B) Linear Unsorted Array", "C) Singly Linked List", "D) FIFO Queue"],
            "correct_answer": "A"
        },
        {
            "id": 2,
            "type": "True / False",
            "company_tag": "Google | 2026",
            "question": f"True or False: In {skill_name}, immutable primitive objects allow in-place memory mutation after initial creation.",
            "options": ["A) TRUE", "B) FALSE"],
            "correct_answer": "B"
        },
        {
            "id": 3,
            "type": "Spot the Bug",
            "company_tag": "Microsoft | 2026",
            "question": f"Identify the error when accessing the 4th element in a 0-indexed collection of size 3 in {skill_name}:\n\nitems = [10, 20, 30]\nval = items[3]",
            "options": ["A) IndexError: list index out of range", "B) SyntaxError on line 1", "C) Memory Leak Warning", "D) StackOverflowError"],
            "correct_answer": "A"
        },
        {
            "id": 4,
            "type": "Complete the Statement",
            "company_tag": "Atlassian | 2026",
            "question": f"To prevent race conditions during concurrent access to shared state in {skill_name}, developers use a ____ lock.",
            "options": ["A) Mutex / Semaphore", "B) Virtual Memory", "C) Garbage Collection", "D) Buffer Overflow"],
            "correct_answer": "A"
        },
        {
            "id": 5,
            "type": "Manual Fill-In",
            "company_tag": "Uber | 2026",
            "question": f"What is the average time complexity (in Big-O notation, e.g. O(1) or O(n)) for hash-indexed lookup in {skill_name}?",
            "options": [],
            "correct_answer": "O(1)"
        },
        {
            "id": 6,
            "type": "Standard MCQ",
            "company_tag": "Flipkart | 2025",
            "question": f"What is the worst-case time complexity of Binary Search on a sorted array of N elements in {skill_name}?",
            "options": ["A) O(log N)", "B) O(N)", "C) O(N log N)", "D) O(1)"],
            "correct_answer": "A"
        },
        {
            "id": 7,
            "type": "True / False",
            "company_tag": "Stripe | 2026",
            "question": f"True or False: A recursive function without a valid termination base case will trigger a Stack Overflow in {skill_name}.",
            "options": ["A) TRUE", "B) FALSE"],
            "correct_answer": "A"
        },
        {
            "id": 8,
            "type": "Spot the Bug",
            "company_tag": "Zomato | 2025",
            "question": f"What is the logical issue in the following loop condition?\n\ncount = 10\nwhile count > 0:\n    count += 1",
            "options": ["A) Infinite loop because count increases instead of decreasing", "B) SyntaxError in while loop header", "C) Variable count is undefined", "D) Loop terminates immediately"],
            "correct_answer": "A"
        },
        {
            "id": 9,
            "type": "Complete the Statement",
            "company_tag": "Razorpay | 2026",
            "question": f"The software design principle stating that a class or module should have only one reason to change is the ____ Principle.",
            "options": ["A) Single Responsibility (SRP)", "B) Open Closed (OCP)", "C) Liskov Substitution (LSP)", "D) Interface Segregation (ISP)"],
            "correct_answer": "A"
        },
        {
            "id": 10,
            "type": "Manual Fill-In",
            "company_tag": "TCS Digital | 2026",
            "question": f"Which HTTP status code number represents 'OK / Success' in REST APIs built with {skill_name}?",
            "options": [],
            "correct_answer": "200"
        }
    ]

    return fallback_suite
