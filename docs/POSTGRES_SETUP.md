# PostgreSQL Setup Guide for AI Hair Architect E2E Testing

## Overview

This guide explains how to set up PostgreSQL for local development and E2E testing on Windows, macOS, and Linux.

**Key Principle**: Test database is **completely isolated** from development database.

---

## 1. Windows Setup (Primary)

### 1.1 Install PostgreSQL

#### Option A: Windows Installer (Recommended)

1. Download PostgreSQL from: https://www.postgresql.org/download/windows/
2. Run installer (version 14 or later)
3. Choose installation directory (default: `C:\Program Files\PostgreSQL\16`)
4. **Important**: Remember the password for the `postgres` user
5. Keep default port: `5432`
6. During installation, uncheck "Stack Builder" (optional)

#### Option B: Chocolatey (Windows Package Manager)

```powershell
choco install postgresql
```

#### Option C: Docker (Alternative - if Docker is available)

```powershell
docker run --name postgres-ai-hair `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=ai_hair_architect_dev `
  -p 5432:5432 `
  -d postgres:16
```

### 1.2 Verify PostgreSQL Installation

```powershell
# Check if psql is in PATH
psql --version

# Output should show: psql (PostgreSQL) 14.x or later

# If not found, add to PATH:
# 1. Open Environment Variables
# 2. Add: C:\Program Files\PostgreSQL\16\bin (adjust version as needed)
# 3. Restart PowerShell
```

### 1.3 Verify PostgreSQL Service

```powershell
# Check if PostgreSQL service is running
Get-Service | Select-String postgres

# Output should show PostgreSQL running

# If not running, start it:
Start-Service PostgreSQL-x64-16  # adjust version number
```

### 1.4 Test Connection

```powershell
# Connect to PostgreSQL (will prompt for password)
psql -h localhost -U postgres -d postgres

# In psql prompt, run:
postgres=# SELECT version();

# Exit psql:
postgres=# \q
```

---

## 2. Setup Test Database (Windows PowerShell)

### 2.1 Run Setup Script

```powershell
# Navigate to project directory
cd path\to\ai-hair-architect\web

# Run PowerShell setup script
.\scripts\setup-test-db.ps1

# Output will show:
# ✓ PostgreSQL found
# ✓ PostgreSQL connection successful
# ✓ Database 'ai_hair_architect_test' created
# ✓ User 'test_user' created
# ✓ Privileges granted
```

### 2.2 What the Script Does

1. **Validates**: Database name contains "test" (safety check)
2. **Checks**: PostgreSQL is installed and running
3. **Creates**: Database `ai_hair_architect_test` (if not exists)
4. **Creates**: User `<TEST_DB_USER>` with password `<TEST_DB_PASSWORD>` (provided or auto-generated)
5. **Grants**: Full privileges to test user
6. **Displays**: Connection details and next steps

### 2.3 Safety Features

✓ **Refuses production names** - Won't create "ai_hair_architect" or "prod"
✓ **Requires confirmation** - Asks before dropping/recreating
✓ **Hides passwords** - Never displays in logs
✓ **Detects PostgreSQL** - Fails early if not installed
✓ **Repeatable** - Safe to run multiple times

---

## 3. Configure Test Database URL (Windows)

### 3.1 Set Environment Variable (Temporary)

```powershell
# For current PowerShell session only:
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"

# Replace:
#   <TEST_DB_USER> with the username (e.g., test_user)
#   <TEST_DB_PASSWORD> with the password from setup script

# Verify:
Write-Host $env:TEST_DATABASE_URL
```

### 3.2 Set Environment Variable (Persistent for User)

```powershell
# Add permanently to user environment:
[Environment]::SetEnvironmentVariable(
  "TEST_DATABASE_URL",
  "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test",
  "User"
)

# Replace:
#   <TEST_DB_USER> with the username
#   <TEST_DB_PASSWORD> with the password

# Restart PowerShell for changes to take effect
```

### 3.3 Verify Connection

```powershell
# With TEST_DATABASE_URL set:
npm run db:test:validate

# Output shows:
# ✓ TEST_DATABASE_URL is valid
# ✓ Host:     localhost
# ✓ Port:     5432
# ✓ Database: ai_hair_architect_test
```

---

## 4. Apply Prisma Migrations

### 4.1 Migrate Test Database

```powershell
# Ensure TEST_DATABASE_URL is set with correct credentials
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"

# Apply all migrations
npm run db:test:migrate

# Output shows migration status
```

### 4.2 Verify Schema

```powershell
# Connect to test database
psql -h localhost -U test_user -d ai_hair_architect_test

# In psql prompt:
ai_hair_architect_test=# \dt

# Shows all tables (User, Session, Client, ImageAsset, etc.)
ai_hair_architect_test=# \q
```

---

## 5. Run E2E Tests

### 5.1 Run All E2E Tests (Contract + Real)

```powershell
# Set environment variable with correct credentials
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"

# Run all tests
npm run test:e2e

# Output shows:
# - 9 contract tests (no database needed)
# - 3 real E2E tests (with database, if TEST_DATABASE_URL is set)
```

### 5.2 Run Only Real Persisted E2E Tests

```powershell
# Set environment variable with correct credentials
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"

# Run real E2E tests only
npm run test:e2e:real

# These tests:
# - Create test users per test
# - Upload images and verify persistence
# - Check role-based access (consumer rejection)
# - Verify cross-user ownership blocking
# - Clean up all data after each test
```

---

## 6. Troubleshooting

### Problem: "psql command not found"

**Solution**:
1. Verify PostgreSQL is installed: `C:\Program Files\PostgreSQL\16` (or your version)
2. Add to PATH: `C:\Program Files\PostgreSQL\16\bin`
3. Restart PowerShell
4. Run: `psql --version`

### Problem: "FATAL: Ident authentication failed for user 'postgres'"

**Solution**:
1. Open pgAdmin (installed with PostgreSQL)
2. Set postgres password
3. Or use `psql -U postgres -W` (with -W flag to prompt for password)

### Problem: "Can't reach database server at localhost:5432"

**Solution**:
1. Check PostgreSQL service: `Get-Service | Select-String postgres`
2. Start service if needed: `Start-Service PostgreSQL-x64-16`
3. Check port 5432 is not blocked: `netstat -ano | Select-String :5432`

### Problem: "Database 'ai_hair_architect_test' already exists"

**Solution**:
```powershell
# The script handles this - it will ask if you want to drop/recreate
# Or manually reset:
.\scripts\setup-test-db.ps1 -Reset -Force
```

### Problem: "TEST_DATABASE_URL not found"

**Solution**:
```powershell
# Verify environment variable is set:
Write-Host $env:TEST_DATABASE_URL

# If empty, set it:
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"
```

---

## 7. Linux/macOS Setup (Optional)

### 7.1 Install PostgreSQL

```bash
# macOS (Homebrew)
brew install postgresql@16
brew services start postgresql@16

# Linux (Ubuntu/Debian)
sudo apt-get install postgresql postgresql-contrib
sudo service postgresql start

# Linux (Fedora/CentOS)
sudo dnf install postgresql-server postgresql-contrib
sudo systemctl start postgresql
```

### 7.2 Setup Test Database

```bash
# Make script executable
chmod +x web/scripts/setup-test-db.sh

# Run setup
./web/scripts/setup-test-db.sh

# To reset database
./web/scripts/setup-test-db.sh -r
```

### 7.3 Set Environment Variable

```bash
# Temporary (current session)
export TEST_DATABASE_URL="postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"

# Replace:
#   <TEST_DB_USER> with the username from setup script
#   <TEST_DB_PASSWORD> with the password

# Persistent (add to ~/.bashrc or ~/.zshrc)
echo 'export TEST_DATABASE_URL="postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"' >> ~/.bashrc
source ~/.bashrc
```

### 7.4 Run E2E Tests

```bash
npm run db:test:migrate
npm run test:e2e:real
```

---

## 8. Docker Alternative (Optional)

If PostgreSQL is not installed but Docker is available:

### 8.1 Start PostgreSQL in Docker

```powershell
# Run PostgreSQL container
docker run --name postgres-test `
  -e POSTGRES_PASSWORD=postgres `
  -p 5432:5432 `
  -d postgres:16

# Wait for startup (~5 seconds)
Start-Sleep -Seconds 5

# Verify running
docker ps
```

### 8.2 Create Test Database (In Container)

```powershell
# Access PostgreSQL inside container
docker exec -it postgres-test psql -U postgres

# In psql:
postgres=# CREATE DATABASE ai_hair_architect_test;
postgres=# CREATE USER <TEST_DB_USER> WITH PASSWORD '<TEST_DB_PASSWORD>';
postgres=# GRANT ALL PRIVILEGES ON DATABASE ai_hair_architect_test TO <TEST_DB_USER>;
postgres=# \q

# Exit container
docker exec postgres-test exit
```

### 8.3 Run E2E Tests

```powershell
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"
npm run test:e2e:real
```

---

## 9. Database Separation

### Development Database: `ai_hair_architect_dev`

- Used by: `npm run dev`
- Connection via: `DATABASE_URL` in `.env.local`
- Manual changes allowed (for development)
- Not used by E2E tests

### Test Database: `ai_hair_architect_test`

- Used by: E2E tests only
- Connection via: `TEST_DATABASE_URL` environment variable
- Automatically created by `npm run db:test:setup`
- Migrations applied by `npm run db:test:migrate`
- Data cleaned automatically between tests

### Production Database

- Configured externally (not local)
- Connection via: Production secrets / CI/CD
- Completely separate from dev and test

---

## 10. Quick Reference Commands

```powershell
# Windows PowerShell

# Setup
.\scripts\setup-test-db.ps1

# Verify (shows sanitized connection details without password)
npm run db:test:validate

# Migrate
npm run db:test:migrate

# Run all E2E tests
npm run test:e2e

# Run real persisted E2E tests only
# IMPORTANT: Set TEST_DATABASE_URL before running
$env:TEST_DATABASE_URL = "postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@localhost:5432/ai_hair_architect_test"
npm run test:e2e:real

# Reset test database
.\scripts\setup-test-db.ps1 -Reset

# Connect to test database manually
psql -h localhost -U <TEST_DB_USER> -d ai_hair_architect_test
```

---

## 11. Security Notes

⚠️ **Test credentials are local only**:
- Username: `<TEST_DB_USER>` (provided or default: `test_user`)
- Password: `<TEST_DB_PASSWORD>` (auto-generated or user-provided)
- Database: `ai_hair_architect_test`

These are for **local testing only**. Never use in production.

✓ **Production databases**: Configured separately, never local
✓ **Credentials in .env**: Git will ignore (already in .gitignore)
✓ **Passwords in scripts**: Test credentials only, non-production

---

## 12. Next Steps

1. ✓ PostgreSQL installed and running
2. ✓ Test database created (`npm run db:test:setup`)
3. ✓ Migrations applied (`npm run db:test:migrate`)
4. ✓ Run E2E tests (`npm run test:e2e:real`)
5. ✓ M9A closure once tests pass (0 failures)

---

For issues or questions, see: `docs/M9_E2E_TEST_SETUP.md`
