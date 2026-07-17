#!/bin/bash
# PostgreSQL Test Database Setup Script (Linux/macOS - Optional)
# Purpose: Create isolated test database for E2E testing
# Safety: Refuses production-like names, requires confirmation, hides passwords

set -e

# Configuration - MUST indicate test environment
TEST_DATABASE_NAME="ai_hair_architect_test"
TEST_DATABASE_USER="${1:-test_user}"
TEST_DATABASE_PASSWORD="${2:-}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

RESET_DB=${3:-}
FORCE=${4:-}

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# If no password provided, prompt securely
if [ -z "$TEST_DATABASE_PASSWORD" ]; then
    echo -e "${YELLOW}Enter password for test database user '$TEST_DATABASE_USER':${NC}"
    echo -e "${GRAY}(Leave empty to use auto-generated)${NC}"
    read -s -p "Password: " TEST_DATABASE_PASSWORD
    echo ""
    if [ -z "$TEST_DATABASE_PASSWORD" ]; then
        TEST_DATABASE_PASSWORD="test_pass_$((RANDOM % 9000 + 1000))"
        echo -e "${CYAN}Using generated password${NC}"
    fi
fi

# Safety: Validate database name indicates test environment
validate_test_database_name() {
    local db_name="$1"

    if [[ "$db_name" =~ (prod|production|live) ]] || [ "$db_name" = "ai_hair_architect" ]; then
        echo -e "${RED}ERROR: Database name '$db_name' appears to be production or development.${NC}"
        echo -e "${RED}Test database name MUST contain 'test' and be clearly isolated.${NC}"
        exit 1
    fi

    if [[ ! "$db_name" =~ test ]]; then
        echo -e "${YELLOW}WARNING: Database name does not contain 'test'.${NC}"
        echo -e "${YELLOW}Test databases must be clearly marked. Proceeding with '$db_name'.${NC}"
        if [ "$FORCE" != "-f" ]; then
            read -p "Continue? (yes/no): " continue
            if [ "$continue" != "yes" ]; then
                echo -e "${CYAN}Cancelled.${NC}"
                exit 0
            fi
        fi
    fi
}

# Check if psql is available
check_postgresql() {
    if ! command -v psql &> /dev/null; then
        echo -e "${RED}ERROR: psql command not found.${NC}"
        echo -e "${RED}PostgreSQL must be installed and psql must be in PATH.${NC}"
        echo -e "${CYAN}See: docs/POSTGRES_SETUP.md for installation instructions.${NC}"
        exit 1
    fi

    local version=$(psql --version)
    echo -e "${GREEN}✓ PostgreSQL found: $version${NC}"
}

# Test PostgreSQL connection
test_postgresql_connection() {
    if ! psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -c "SELECT 1;" &>/dev/null; then
        echo -e "${RED}ERROR: Cannot connect to PostgreSQL at $POSTGRES_HOST:$POSTGRES_PORT${NC}"
        echo -e "${RED}Ensure PostgreSQL service is running.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ PostgreSQL connection successful${NC}"
}

# Create test database
create_test_database() {
    echo -e "${CYAN}Creating test database...${NC}"

    # Check if database exists
    local db_exists=$(psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = '$TEST_DATABASE_NAME';" 2>/dev/null || echo "")

    if [ "$db_exists" = "1" ]; then
        echo -e "${YELLOW}! Database '$TEST_DATABASE_NAME' already exists.${NC}"
        if [ "$RESET_DB" != "-r" ] && [ "$FORCE" != "-f" ]; then
            read -p "Drop and recreate? (yes/no): " continue
            if [ "$continue" != "yes" ]; then
                echo -e "${CYAN}Using existing database.${NC}"
                return 0
            fi
        fi
        echo -e "${YELLOW}Dropping existing database...${NC}"
        psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $TEST_DATABASE_NAME;" 2>/dev/null
    fi

    # Create database
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $TEST_DATABASE_NAME;" 2>/dev/null
    echo -e "${GREEN}✓ Database '$TEST_DATABASE_NAME' created${NC}"
}

# Create test user
create_test_user() {
    echo -e "${CYAN}Creating test user...${NC}"

    # Check if user exists
    local user_exists=$(psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -t -c "SELECT 1 FROM pg_roles WHERE rolname = '$TEST_DATABASE_USER';" 2>/dev/null || echo "")

    if [ "$user_exists" = "1" ]; then
        echo -e "${YELLOW}! User '$TEST_DATABASE_USER' already exists.${NC}"
        echo -e "${GREEN}✓ User will be reused${NC}"
        return 0
    fi

    # Create user (password will not be echoed)
    local escaped_password="${TEST_DATABASE_PASSWORD//\'/\'\'}"
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -c "CREATE USER $TEST_DATABASE_USER WITH PASSWORD '$escaped_password';" 2>/dev/null
    echo -e "${GREEN}✓ User '$TEST_DATABASE_USER' created${NC}"
}

# Grant privileges
grant_privileges() {
    echo -e "${CYAN}Granting privileges...${NC}"

    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE $TEST_DATABASE_NAME TO $TEST_DATABASE_USER;" 2>/dev/null
    echo -e "${GREEN}✓ Privileges granted${NC}"
}

# Display connection string
display_connection_string() {
    echo -e "\n${CYAN}========================================${NC}"
    echo -e "${GREEN}Test Database Setup Complete${NC}"
    echo -e "${CYAN}========================================${NC}"

    echo -e "\n${CYAN}Connection Details:${NC}"
    echo -e "${CYAN}  Database:  $TEST_DATABASE_NAME${NC}"
    echo -e "${CYAN}  User:      $TEST_DATABASE_USER${NC}"
    echo -e "${CYAN}  Host:      $POSTGRES_HOST${NC}"
    echo -e "${CYAN}  Port:      $POSTGRES_PORT${NC}"

    echo -e "\n${YELLOW}Next steps:${NC}"
    echo -e "${CYAN}1. Set TEST_DATABASE_URL environment variable:${NC}"
    echo -e "   export TEST_DATABASE_URL=postgresql://<TEST_DB_USER>:<TEST_DB_PASSWORD>@$POSTGRES_HOST:$POSTGRES_PORT/$TEST_DATABASE_NAME"
    echo -e "   (Replace <TEST_DB_USER> with '$TEST_DATABASE_USER' and <TEST_DB_PASSWORD> with your password)"

    echo -e "\n${CYAN}2. Apply Prisma migrations:${NC}"
    echo -e "   npm run db:test:migrate"

    echo -e "\n${CYAN}3. Run E2E tests:${NC}"
    echo -e "   npm run test:e2e:real"

    echo -e "\n${CYAN}For documentation: docs/POSTGRES_SETUP.md${NC}"
    echo -e "${CYAN}========================================\n${NC}"
}

# Main execution
main() {
    echo -e "${CYAN}PostgreSQL Test Database Setup Script (Linux/macOS)${NC}"
    echo -e "${CYAN}===================================================${NC}"

    # Validate parameters
    validate_test_database_name "$TEST_DATABASE_NAME"

    # Check prerequisites
    echo -e "\n${CYAN}Checking prerequisites...${NC}"
    check_postgresql
    test_postgresql_connection

    # Create database and user
    create_test_database
    create_test_user
    grant_privileges

    # Display results
    display_connection_string
}

# Run main
main "$@"
