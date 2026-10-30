import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GROQ_API_KEY")

print("Key Loaded:", api_key[:10] + "..." if api_key else "NO KEY FOUND")

client = Groq(api_key=api_key)
try:
    models = client.models.list()
    print("\n--- YOUR AVAILABLE GROQ MODELS ---")
    for m in models.data:
        print(f"-> {m.id}")
except Exception as e:
    print("Error listing models:", e)