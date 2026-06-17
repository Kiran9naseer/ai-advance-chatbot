@echo off
echo ===================================
echo Starting AI Chatbot Full-Stack App
echo ===================================

echo.
echo Installing Python dependencies...
pip install -r requirements.txt

echo.
echo Starting FastAPI Backend Server...
start cmd /k "uvicorn main:app --reload"

echo.
echo Opening Frontend in Browser...
timeout /t 3 > nul
start index.html

echo.
echo Setup Complete! The backend terminal will stay open.
echo You can close this window now.
pause
