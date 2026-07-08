param(
  [string]$Message = "chore: sync project changes"
)

Set-Location $PSScriptRoot/..

git status --short

git add -A

git commit -m $Message

git push origin main
