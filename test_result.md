#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Round 8 (2026-06-26) — Sign-in "Network request failed" on device APK
- User report: On installed Android APK, tapping "Sign in" shows "Network request failed".
- Diagnosis: Backend is up & reachable at current preview URL (POST /api/auth/login -> 401 for bad creds). App code (api.ts BASE = EXPO_PUBLIC_BACKEND_URL + /api) is correct. Root cause is the APK baking a stale/unreachable EXPO_PUBLIC_BACKEND_URL (forked env changed the preview URL; GitHub secret likely points to old URL). Not an app code regression.
- Also fixed welcome.tsx (scrollable + pinned CTA footer).
- Test request: Verify auth end-to-end in preview — register a fresh user via UI, then sign out and sign back in successfully; confirm no regression from welcome.tsx change.

## Round 9 (2026-06-26) — Login "404 page not found" + in-app server override
- User report: On device, login showed "404 page not found" (previously "Network request failed"). RCA: the APK's baked EXPO_PUBLIC_BACKEND_URL points to a wrong/stale host whose ingress returns plain-text "404 page not found" for /api. Confirmed current preview backend is healthy (POST /api/auth/login -> 422/200).
- Fix: added src/lib/config.ts (normalizeHost + loadApiBase/getApiBase/getServerHost/setServerHost with AsyncStorage override). api.ts now uses getApiBase(); realtime.ts uses getServerHost() for WS. AuthContext.boot calls loadApiBase() first. Added a "Server settings" panel on the login screen (testIDs: login-server-toggle, login-server-input, login-server-save, login-server-note) so users can point the app at the correct backend on-device WITHOUT rebuilding.
- Test request: (1) verify normal login still works end-to-end with real creds; (2) verify the server-settings panel: toggle open, field prefilled with current host, save persists; (3) ensure normalizeHost handles trailing slash / missing scheme / trailing /api.
- Real creds: thomasgallacher92@gmail.com / Ladyinred_1
