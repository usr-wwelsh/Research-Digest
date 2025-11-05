@echo off
REM ArXiv Digest Runner - Sets up environment and runs the script
cd /d "%~dp0"

REM Check if virtual environment exists
if not exist "venv\" (
    echo Virtual environment not found. Creating one...
    python -m venv venv
    if errorlevel 1 (
        echo Error creating virtual environment!
        echo Make sure Python is installed and available in PATH.
        pause
        exit /b 1
    )
    echo Virtual environment created successfully.

    echo Installing dependencies...
    call venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    if errorlevel 1 (
        echo Error installing dependencies!
        pause
        exit /b 1
    )
    echo Dependencies installed successfully.
) else (
    call venv\Scripts\activate.bat
)

echo Running arXiv digest...
python main.py
if errorlevel 1 (
    echo Error running main script!
    pause
    goto :end
)

echo Generating index page...
python generate_index.py
if errorlevel 1 (
    echo Error generating index!
    pause
    goto :end
)

echo Done! All files updated.
pause
:end
deactivate
