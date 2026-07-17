# PostgreSQL Test Database Setup Script (Windows PowerShell)
# Purpose: Create isolated test database for E2E testing
# Safety: Refuses production-like names, requires confirmation, hides passwords

param(
    [switch]$Reset = $false,
    [switch]$Force = $false,
    [switch]$CIMode = $false,
    [string]$TestUser = "test_user",
    [string]$TestPassword = "",
    [string]$PostgreSQLUser = "postgres",
    [string]$PostgreSQLHost = "localhost",
    [int]$PostgreSQLPort = 5432
)

# Configuration - MUST indicate test environment
$TestDatabaseName = "ai_hair_architect_test"
$PostgreSQLHost = $PostgreSQLHost
$PostgreSQLPort = $PostgreSQLPort

# If no password provided, prompt securely
if (-not $TestPassword) {
    Write-Host "Enter password for test database user '$TestUser':" -ForegroundColor Yellow
    Write-Host "(Leave empty to use auto-generated: test_pass_$(Get-Random -Minimum 1000 -Maximum 9999))" -ForegroundColor Gray
    $securePassword = Read-Host -AsSecureString "Password"
    if ($securePassword.Length -eq 0) {
        $TestPassword = "test_pass_$(Get-Random -Minimum 1000 -Maximum 9999)"
        Write-Host "Using generated password" -ForegroundColor Cyan
    } else {
        $TestPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
    }
}

# Safety: Validate database name indicates test environment
function Validate-TestDatabaseName {
    param([string]$dbName)

    if ($dbName -match "(prod|production|live)" -or $dbName -eq "ai_hair_architect") {
        Write-Host "ERROR: Database name '$dbName' appears to be production or development." -ForegroundColor Red
        Write-Host "Test database name MUST contain 'test' and be clearly isolated." -ForegroundColor Red
        exit 1
    }

    if (-not ($dbName -match "test")) {
        Write-Host "WARNING: Database name does not contain 'test'." -ForegroundColor Yellow
        Write-Host "Test databases must be clearly marked. Proceeding with '$dbName'." -ForegroundColor Yellow
        if (-not $Force) {
            $continue = Read-Host "Continue? (yes/no)"
            if ($continue -ne "yes") {
                Write-Host "Cancelled." -ForegroundColor Cyan
                exit 0
            }
        }
    }
}

# Check if psql is available
function Check-PostgreSQL {
    try {
        $version = & psql --version 2>$null
        if (-not $?) {
            throw "psql not found"
        }
        Write-Host "✓ PostgreSQL found: $version" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "ERROR: psql command not found." -ForegroundColor Red
        Write-Host "PostgreSQL must be installed and psql must be in PATH." -ForegroundColor Red
        Write-Host "See: docs/POSTGRES_SETUP.md for installation instructions." -ForegroundColor Cyan
        exit 1
    }
}

# Test PostgreSQL connection
function Test-PostgreSQLConnection {
    try {
        $null = & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -c "SELECT 1;" 2>$null
        if (-not $?) {
            throw "Connection failed"
        }
        Write-Host "✓ PostgreSQL connection successful" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "ERROR: Cannot connect to PostgreSQL at $PostgreSQLHost`:$PostgreSQLPort" -ForegroundColor Red
        Write-Host "Ensure PostgreSQL service is running." -ForegroundColor Red
        exit 1
    }
}

# Create test database
function Create-TestDatabase {
    Write-Host "`nCreating test database..." -ForegroundColor Cyan

    # Check if database exists
    $dbExists = & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = '$TestDatabaseName';" 2>$null

    if ($dbExists -eq "1") {
        Write-Host "! Database '$TestDatabaseName' already exists." -ForegroundColor Yellow
        if (-not $Reset -and -not $Force) {
            $continue = Read-Host "Drop and recreate? (yes/no)"
            if ($continue -ne "yes") {
                Write-Host "Using existing database." -ForegroundColor Cyan
                return $true
            }
        }
        if ($Reset -and -not $CIMode -and -not $Force) {
            Write-Host "WARNING: This will drop and recreate the test database." -ForegroundColor Yellow
            $confirm = Read-Host "Are you absolutely sure? (yes/no)"
            if ($confirm -ne "yes") {
                Write-Host "Cancelled." -ForegroundColor Cyan
                exit 0
            }
        }
        Write-Host "Dropping existing database..." -ForegroundColor Yellow
        & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -c "DROP DATABASE IF EXISTS $TestDatabaseName;" 2>$null
        if (-not $?) {
            Write-Host "ERROR: Failed to drop database." -ForegroundColor Red
            exit 1
        }
    }

    # Create database
    & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -c "CREATE DATABASE $TestDatabaseName;" 2>$null
    if (-not $?) {
        Write-Host "ERROR: Failed to create database." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Database '$TestDatabaseName' created" -ForegroundColor Green
}

# Create test user
function Create-TestUser {
    Write-Host "`nCreating test user..." -ForegroundColor Cyan

    # Check if user exists
    $userExists = & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -t -c "SELECT 1 FROM pg_roles WHERE rolname = '$TestUser';" 2>$null

    if ($userExists -eq "1") {
        Write-Host "! User '$TestUser' already exists." -ForegroundColor Yellow
        Write-Host "✓ User will be reused" -ForegroundColor Green
        return $true
    }

    # Create user with password (password will not be echoed to console)
    # Password is embedded in the command but not shown in logs
    $escapedPassword = $TestPassword -replace "'", "''"
    $psqlCommand = "CREATE USER $TestUser WITH PASSWORD '$escapedPassword';"
    & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -c $psqlCommand 2>$null
    if (-not $?) {
        Write-Host "ERROR: Failed to create user." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ User '$TestUser' created" -ForegroundColor Green
}

# Grant privileges
function Grant-Privileges {
    Write-Host "`nGranting privileges..." -ForegroundColor Cyan

    $grantCommand = "GRANT ALL PRIVILEGES ON DATABASE $TestDatabaseName TO $TestUser;"
    & psql -h $PostgreSQLHost -U $PostgreSQLUser -d postgres -c $grantCommand 2>$null
    if (-not $?) {
        Write-Host "ERROR: Failed to grant privileges." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Privileges granted" -ForegroundColor Green
}

# Display connection string (WITHOUT password in console logs)
function Display-ConnectionString {
    Write-Host "`n" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Test Database Setup Complete" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan

    Write-Host "`nConnection Details:" -ForegroundColor White
    Write-Host "  Database:  $TestDatabaseName" -ForegroundColor White
    Write-Host "  User:      $TestUser" -ForegroundColor White
    Write-Host "  Host:      $PostgreSQLHost" -ForegroundColor White
    Write-Host "  Port:      $PostgreSQLPort" -ForegroundColor White

    Write-Host "`nNext steps:" -ForegroundColor Yellow
    Write-Host "1. Set TEST_DATABASE_URL environment variable:" -ForegroundColor Cyan
    Write-Host "   `$env:TEST_DATABASE_URL = 'postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@$PostgreSQLHost:$PostgreSQLPort/$TestDatabaseName'" -ForegroundColor White
    Write-Host "   (Replace <TEST_DB_USER> with '$TestUser' and <TEST_DB_PASSWORD> with your password)" -ForegroundColor Gray

    Write-Host "`n2. Apply Prisma migrations:" -ForegroundColor Cyan
    Write-Host "   npm run db:test:migrate" -ForegroundColor White

    Write-Host "`n3. Run E2E tests:" -ForegroundColor Cyan
    Write-Host "   npm run test:e2e:real" -ForegroundColor White

    Write-Host "`nFor documentation: docs/POSTGRES_SETUP.md" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

# Main execution
function Main {
    Write-Host "PostgreSQL Test Database Setup Script (Windows)" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan

    # Validate parameters
    Validate-TestDatabaseName $TestDatabaseName

    # Check prerequisites
    Write-Host "`nChecking prerequisites..." -ForegroundColor Cyan
    Check-PostgreSQL
    Test-PostgreSQLConnection

    # Create database and user
    Create-TestDatabase
    Create-TestUser
    Grant-Privileges

    # Display results
    Display-ConnectionString
}

# Run main
Main
