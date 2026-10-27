@echo off
rem Lance un petit serveur web local pour tester Le 98 sur ce PC, puis ouvre le navigateur.
rem Fermer cette fenetre arrete le serveur.
cd /d "%~dp0"
echo Le 98 : serveur local sur http://localhost:8098  (fermer cette fenetre pour l'arreter)
start "" http://localhost:8098
python -m http.server 8098
if errorlevel 1 (
  echo.
  echo Python est introuvable. Installe-le depuis https://www.python.org/downloads/ puis relance ce fichier.
  pause
)
