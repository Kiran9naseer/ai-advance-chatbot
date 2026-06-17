from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv
import asyncio
import time

# Load environment variables
load_dotenv()

app = FastAPI(title="NexusAI Chatbot API")

import sqlite3
import uuid
import PyPDF2
import io
import requests
from duckduckgo_search import DDGS

# Database Setup
def init_db():
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            role TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN context TEXT")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()

init_db()

def get_session_history(session_id):
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return [{"role": "system", "content": "You are NexusAI, a helpful and polite customer support AI assistant for a SaaS company. Keep your answers concise and use markdown for formatting."}]
    
    history = [{"role": "system", "content": "You are NexusAI, a helpful and polite customer support AI assistant for a SaaS company. Keep your answers concise and use markdown for formatting."}]
    for r in rows:
        history.append({"role": r[0], "content": r[1]})
    return history

def save_message(session_id, role, content):
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", (session_id, role, content))
    conn.commit()
    conn.close()

def create_or_update_session(session_id, title=None):
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
    if not cursor.fetchone():
        cursor.execute("INSERT INTO sessions (id, title) VALUES (?, ?)", (session_id, title or "New Chat"))
    elif title:
        cursor.execute("SELECT title FROM sessions WHERE id = ?", (session_id,))
        current_title = cursor.fetchone()[0]
        if current_title == "New Chat":
            cursor.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))
    conn.commit()
    conn.close()


# Add CORS middleware so our HTML file can talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    web_search: bool = False
    system_prompt: Optional[str] = None
    model: Optional[str] = "gpt-oss-120b"
    regenerate: Optional[bool] = False
    
class ChatResponse(BaseModel):
    response: str
    status: str

class RenameRequest(BaseModel):
    title: str

# Mock AI Response Engine for testing without OpenAI API Key
def generate_mock_response(message: str) -> str:
    msg = message.lower()
    if any(word in msg for word in ["hi", "hello", "hey"]):
        return "Hello! 👋 Welcome to NexusAI Support. I am responding from the FastAPI Backend! How can I assist you today?"
    if any(word in msg for word in ["price", "pricing", "cost"]):
        return "Here are our pricing plans directly from the server:\n\n💎 **Starter Plan** — $9/month\n🚀 **Pro Plan** — $29/month\n🏢 **Enterprise** — Custom pricing"
    if any(word in msg for word in ["tech", "support", "issue", "bug"]):
        return "I can help with technical issues. Please provide your error code. (This is a backend response)"
    
    return f"I received your message on the backend: '{message}'. \n\n*Note: Add your OpenAI API key to the .env file to get real AI-generated responses!*"

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    openai_api_key = os.getenv("OPENAI_API_KEY")
    cerebras_api_key = os.getenv("CEREBRAS_API_KEY")
    
    try:
        if cerebras_api_key and cerebras_api_key != "your_api_key_here":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(
                api_key=cerebras_api_key,
                base_url="https://api.cerebras.ai/v1"
            )
            completion = await client.chat.completions.create(
                model="gpt-oss-120b",
                messages=[
                    {"role": "system", "content": "You are NexusAI, a helpful and polite customer support AI assistant for a SaaS company. Keep your answers concise and use markdown for formatting."},
                    {"role": "user", "content": request.message}
                ]
            )
            response_text = completion.choices[0].message.content
            return ChatResponse(response=response_text, status="success")
            
        elif openai_api_key and openai_api_key != "your_api_key_here":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=openai_api_key)
            completion = await client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are NexusAI, a helpful and polite customer support AI assistant for a SaaS company. Keep your answers concise and use markdown for formatting."},
                    {"role": "user", "content": request.message}
                ]
            )
            response_text = completion.choices[0].message.content
            return ChatResponse(response=response_text, status="success")
            
        else:
            # If no valid API key is set, use the mock engine so the UI still works
            await asyncio.sleep(1.5)
            response_text = generate_mock_response(request.message)
            return ChatResponse(response=response_text, status="success")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def serve_frontend():
    return FileResponse("index.html")

@app.get("/style.css")
def serve_css():
    return FileResponse("style.css", media_type="text/css")

@app.get("/script.js")
def serve_js():
    return FileResponse("script.js", media_type="application/javascript")

@app.get("/sessions")
def get_sessions():
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("SELECT id, title FROM sessions ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "title": r[1]} for r in rows]

@app.get("/chat/{session_id}")
def get_chat(session_id: str):
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"role": r[0], "content": r[1]} for r in rows]

@app.delete("/chat/{session_id}")
def delete_chat(session_id: str):
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Chat deleted"}

@app.put("/chat/{session_id}/rename")
def rename_chat(session_id: str, req: RenameRequest):
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET title = ? WHERE id = ?", (req.title, session_id))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Chat renamed"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = Form(...)):
    try:
        content = await file.read()
        text = ""
        filename = file.filename.lower()
        
        if filename.endswith(".pdf"):
            reader = PyPDF2.PdfReader(io.BytesIO(content))
            for page in reader.pages:
                text += page.extract_text() + "\n"
        elif filename.endswith((".png", ".jpg", ".jpeg")):
            res = requests.post(
                'https://api.ocr.space/parse/image',
                data={'apikey': 'helloworld'},
                files={'file': (file.filename, content)}
            )
            data = res.json()
            if not data.get("IsErroredOnProcessing"):
                for result in data.get("ParsedResults", []):
                    text += result.get("ParsedText", "") + "\n"
            else:
                raise Exception("OCR Failed: " + str(data.get("ErrorMessage")))
        else:
            text = content.decode("utf-8")
            
        conn = sqlite3.connect("chats.db")
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not cursor.fetchone():
            cursor.execute("INSERT INTO sessions (id, title, context) VALUES (?, ?, ?)", (session_id, "Document Chat", text))
        else:
            cursor.execute("UPDATE sessions SET context = ? WHERE id = ?", (text, session_id))
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "File uploaded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat_stream")
async def chat_stream_endpoint(request: ChatRequest):
    openai_api_key = os.getenv("OPENAI_API_KEY")
    cerebras_api_key = os.getenv("CEREBRAS_API_KEY")
    
    session_id = request.session_id
    create_or_update_session(session_id, title=request.message[:30] + "...")
    
    if request.regenerate:
        conn = sqlite3.connect("chats.db")
        cursor = conn.cursor()
        cursor.execute("SELECT id, role FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1", (session_id,))
        last_msg = cursor.fetchone()
        if last_msg and last_msg[1] == 'assistant':
            cursor.execute("DELETE FROM messages WHERE id = ?", (last_msg[0],))
            conn.commit()
        conn.close()
    else:
        save_message(session_id, "user", request.message)
    
    conversation_history = get_session_history(session_id)
    
    # Apply custom system prompt if provided
    if request.system_prompt:
        if conversation_history and conversation_history[0]["role"] == "system":
            conversation_history[0]["content"] = request.system_prompt
    
    conn = sqlite3.connect("chats.db")
    cursor = conn.cursor()
    cursor.execute("SELECT context FROM sessions WHERE id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row and row[0]:
        conversation_history[0]["content"] += f"\n\nContext information from uploaded document:\n{row[0]}"
        
    # Web Search logic
    if request.web_search:
        try:
            results = DDGS().text(request.message, max_results=3)
            search_context = "\n\nLatest Web Search Results:\n"
            for r in results:
                search_context += f"- {r['title']}: {r['body']} ({r['href']})\n"
            conversation_history[0]["content"] += search_context + "\nUse the above search results to accurately answer the user's latest message if relevant."
        except Exception as e:
            print("Web Search failed:", e)
    
    async def event_stream():
        selected_model = request.model or "gpt-oss-120b"
        max_retries = 3
        retry_delay = 5  # seconds

        for attempt in range(max_retries):
            try:
                if cerebras_api_key and cerebras_api_key != "your_api_key_here":
                    from openai import AsyncOpenAI
                    client = AsyncOpenAI(api_key=cerebras_api_key, base_url="https://api.cerebras.ai/v1")
                    
                    stream = await client.chat.completions.create(
                        model=selected_model,
                        messages=conversation_history,
                        stream=True
                    )
                    
                    full_response = ""
                    async for chunk in stream:
                        if chunk.choices[0].delta.content is not None:
                            content = chunk.choices[0].delta.content
                            full_response += content
                            yield content
                            await asyncio.sleep(0.02)
                    
                    save_message(session_id, "assistant", full_response)
                    return  # success, exit retry loop

                elif openai_api_key and openai_api_key != "your_api_key_here":
                    from openai import AsyncOpenAI
                    client = AsyncOpenAI(api_key=openai_api_key)
                    
                    stream = await client.chat.completions.create(
                        model="gpt-3.5-turbo",
                        messages=conversation_history,
                        stream=True
                    )
                    
                    full_response = ""
                    async for chunk in stream:
                        if chunk.choices[0].delta.content is not None:
                            content = chunk.choices[0].delta.content
                            full_response += content
                            yield content
                            await asyncio.sleep(0.02)
                            
                    save_message(session_id, "assistant", full_response)
                    return  # success
                    
                else:
                    await asyncio.sleep(0.5)
                    mock_res = generate_mock_response(request.message)
                    full_response = ""
                    for word in mock_res.split(" "):
                        content = word + " "
                        full_response += content
                        yield content
                        await asyncio.sleep(0.05)
                    save_message(session_id, "assistant", full_response)
                    return

            except Exception as e:
                error_str = str(e)
                is_rate_limit = "429" in error_str or "too_many_requests" in error_str or "queue_exceeded" in error_str
                
                if is_rate_limit and attempt < max_retries - 1:
                    wait = retry_delay * (attempt + 1)
                    yield f"\n\n⏳ Server is busy. Retrying in {wait}s... (attempt {attempt + 1}/{max_retries})"
                    await asyncio.sleep(wait)
                    continue
                elif is_rate_limit:
                    yield "\n\n❌ **Server is overloaded.** Please try again in a moment or switch to the other model (Z.ai GLM 4.7) from the dropdown."
                else:
                    yield f"\n\nError: {error_str}"
                return

    return StreamingResponse(event_stream(), media_type="text/plain")

@app.get("/health")
def health_check():
    return {"status": "Backend is running flawlessly!"}

# To run this server manually: uvicorn main:app --reload
