@echo off
REM Run from repo: metro_viz\run_prepare_data.bat --dataset YOUR_EXPORT_FOLDER_NAME
REM Example:
REM   run_prepare_data.bat --dataset HeatedFlowEnsemble_eps1.0 --coupling direct --spatial-x 0 127 --spatial-y 0 255

cd /d "%~dp0"
python prepare_data.py %*
