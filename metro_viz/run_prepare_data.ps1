# Run prepare_data.py from this folder (forwards all args to Python).
#
# Examples:
#   .\run_prepare_data.ps1 --dataset HeatedFlowEnsemble_eps1.0
#   .\run_prepare_data.ps1 --dataset HeatedFlowEnsemble_eps1.0 --coupling direct --spatial-x 0 127 --spatial-y 0 255
#   .\run_prepare_data.ps1 --dataset MyRun --export-root "C:\path\to\barycenter_export"

Set-Location $PSScriptRoot
python prepare_data.py @args
