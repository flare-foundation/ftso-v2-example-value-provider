#!/bin/bash

# FTSOv2 Provider Control Script
# Manages the docker-compose service lifecycle

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
SERVICE_NAME="ftso-v2-provider"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if docker-compose is available
check_docker_compose() {
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}Error: docker-compose is not installed or not in PATH${NC}" >&2
        exit 1
    fi
}

# Function to check if service is running
is_running() {
    docker-compose -f "${COMPOSE_FILE}" ps | grep -q "${SERVICE_NAME}" && \
    docker-compose -f "${COMPOSE_FILE}" ps | grep "${SERVICE_NAME}" | grep -q "Up"
}

# Start the service
start() {
    check_docker_compose
    echo -e "${GREEN}Starting ${SERVICE_NAME}...${NC}"
    
    if is_running; then
        echo -e "${YELLOW}Service is already running${NC}"
        return 0
    fi
    
    cd "${SCRIPT_DIR}"
    docker-compose up -d
    
    echo -e "${GREEN}Service started successfully${NC}"
    echo -e "View logs with: ${YELLOW}./control.sh logs${NC}"
    echo -e "API available at: ${YELLOW}http://localhost:3101${NC}"
    echo -e "API docs at: ${YELLOW}http://localhost:3101/api-doc${NC}"
}

# Stop the service
stop() {
    check_docker_compose
    echo -e "${GREEN}Stopping ${SERVICE_NAME}...${NC}"
    
    if ! is_running; then
        echo -e "${YELLOW}Service is not running${NC}"
        return 0
    fi
    
    cd "${SCRIPT_DIR}"
    docker-compose down
    
    echo -e "${GREEN}Service stopped successfully${NC}"
}

# Restart the service
restart() {
    check_docker_compose
    echo -e "${GREEN}Restarting ${SERVICE_NAME}...${NC}"
    
    cd "${SCRIPT_DIR}"
    docker-compose restart
    
    echo -e "${GREEN}Service restarted successfully${NC}"
}

# Show logs
logs() {
    check_docker_compose
    
    local follow="${1:-}"
    cd "${SCRIPT_DIR}"
    
    if [ "$follow" = "-f" ] || [ "$follow" = "--follow" ]; then
        echo -e "${GREEN}Following logs for ${SERVICE_NAME}...${NC}"
        echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
        # Suppress docker-compose event watcher errors (known issue in v1.29.2)
        # These are harmless threading errors that don't affect functionality
        docker-compose logs -f 2>/dev/null || docker-compose logs -f
    else
        docker-compose logs --tail=100 2>/dev/null || docker-compose logs --tail=100
    fi
}

# Show service status
status() {
    check_docker_compose
    
    cd "${SCRIPT_DIR}"
    
    echo -e "${GREEN}Service Status:${NC}"
    echo ""
    
    if is_running; then
        echo -e "Status: ${GREEN}Running${NC}"
        echo ""
        docker-compose ps
        echo ""
        echo -e "API available at: ${YELLOW}http://localhost:3101${NC}"
        echo -e "API docs at: ${YELLOW}http://localhost:3101/api-doc${NC}"
    else
        echo -e "Status: ${RED}Stopped${NC}"
        echo ""
        docker-compose ps
    fi
}

# Show help
help() {
    cat << EOF
FTSOv2 Provider Control Script

Usage: ./control.sh [COMMAND]

Commands:
    start       Start the service
    stop        Stop the service
    restart     Restart the service
    status      Show service status
    logs        Show service logs (last 100 lines)
    logs -f     Follow service logs (real-time)
    help        Show this help message

Examples:
    ./control.sh start
    ./control.sh stop
    ./control.sh restart
    ./control.sh status
    ./control.sh logs
    ./control.sh logs -f

Environment Variables:
    BASE_URL    Override the base URL for API endpoints (default: http://localhost:3101)

EOF
}

# Main command handler
case "${1:-help}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs "${2:-}"
        ;;
    help|--help|-h)
        help
        ;;
    *)
        echo -e "${RED}Unknown command: ${1}${NC}" >&2
        echo ""
        help
        exit 1
        ;;
esac

