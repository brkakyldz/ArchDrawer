@echo off
rem The archdrawer launcher for PowerShell and cmd: runs bin/archdrawer.mjs with node.
where node >nul 2>nul || (echo archdrawer needs Node.js 20.19 or newer: https://nodejs.org 1>&2 & exit /b 1)
node "%~dp0archdrawer.mjs" %*
