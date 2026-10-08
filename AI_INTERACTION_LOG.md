# AI Interaction & Architectural Decision Log
### Candidate Tool Usage Transparency & Design Journey
**Assessment:** Factory Traffic Management System — Backend Developer Intern Assessment V2  
**Candidate Name:** Mahim  
**Tools Consulted:** Gemini 3.8 / Claude 3.7 Sonnet  

---

## 1. Overview & Tool Usage Statement

Per Section 18.12 and Section 22 of the assessment guidelines, AI tools were utilized during development as an **architectural sounding board, edge-case reviewer, and rubber-duck debugger**. 

All architectural decisions, safety invariants, transition sequence rules, schema design, and trade-off selections were directed and evaluated by the candidate. Below is the chronological record of key design discussions and debugging interactions conducted during the 4–5 hour assessment.

---

## 2. Chronological Interaction Records

### Turn 1: Database Storage & Architecture Separation Decision
* **Candidate Inquiry:**  
  "For database storage, should I use PostgreSQL with Docker or Node 24 built-in SQLite? Since this is a 4-5 hour intern assessment, I want to avoid external database setup while still guaranteeing ACID persistence across restarts."
* **Discussion Summary:**  
  Evaluated the trade-offs of Dockerized Postgres vs native `node:sqlite` (`DatabaseSync`). Confirmed that Node.js 24 provides embedded ACID-compliant SQLite without external installation overhead, ensuring evaluators can run the project immediately with zero configuration.
* **Architectural Decision:**  
  Adopted `node:sqlite` in `backend/database/db.js` with pure relational schema in `schema.sql`. Strictly separated the domain engine (`backend/domain/`) from Express HTTP controllers (`backend/routes/`).

---

### Turn 2: Safety Clearance & State Machine Design
* **Candidate Inquiry:**  
  "For the traffic signal state machine, the requirements say Green is 30s and Yellow is 5s for North/South and East/West phases. But I noticed a safety gap: if North/South turns Red and East/West immediately turns Green, a slow forklift clearing the intersection could collide with incoming traffic. I'm deciding to add an explicit 2-second ALL_RED clearance interval between opposing phases. How should I implement this state machine in pure JavaScript without using blocking sleep() functions?"
* **Discussion Summary:**  
  Analyzed asynchronous timer coordination. Confirmed that an explicit `ALL_RED` phase eliminates the risk of yellow-trap collisions. Confirmed using chained non-blocking `setTimeout` callbacks rather than thread-blocking sleep loops.
* **Architectural Decision:**  
  Implemented a 4-state deterministic sequence in `trafficEngine.js`:
  `NORTH_SOUTH GREEN -> NORTH_SOUTH YELLOW (5s) -> ALL_RED (2s) -> EAST_WEST GREEN (30s)`

---

### Turn 3: Sensor Idempotency & Queue Underflow
* **Candidate Inquiry:**  
  "Sensors send VEHICLE_ARRIVED events with an event_id. Due to network retries, the same event might arrive multiple times. The spec says duplicate events must not increase the queue count twice. I'm deciding how to handle this in SQLite: should I store event_id in a processed_events table and check it before updating vehicle_queue? Also, what should happen if a VEHICLE_CLEARED event arrives when the queue is already 0?"
* **Discussion Summary:**  
  Discussed transactional deduplication. Confirmed checking a persistent `processed_events` table before modifying `vehicle_queue`. For underflow protection, enforced non-negative clamping so missed arrivals or spurious clearance signals cannot drive queue counters below zero.
* **Architectural Decision:**  
  Implemented `processed_events` table in `schema.sql` and idempotent rejection in `queueManager.js`. Added defensive clamping in `clearVehicle()` (`db.js`).

---

### Turn 4: Concurrency Race Condition Bug (Emergency vs In-Flight Transition)
* **Candidate Inquiry:**  
  "I ran into a serious bug while testing my traffic engine: North and South currently have GREEN. The automatic cycle starts transitioning and sets North and South to YELLOW with a 5 second timer. At second 2, an emergency vehicle arrives from EAST, calling transitionToPhase('EAST_WEST'). Now two setTimeout timers are active. When both finish, both North and East turn GREEN simultaneously, violating Safety Rule 1. How should I solve this race condition in Node.js?"
* **Discussion Summary:**  
  Identified that multiple asynchronous timers were writing to `desired_signals` concurrently without synchronization. Discussed mutex patterns vs event-queue serialisation in single-threaded Node.js.
* **Architectural Decision:**  
  Introduced `transitionLocks = new Map()` in `trafficEngine.js`. When a transition begins, the lock is acquired for that junction. Any competing transition attempt is safely rejected or queued until the clearance cycle finishes, mathematically guaranteeing zero simultaneous greens.

---

### Turn 5: Node.js Test Runner Hanging Bug
* **Candidate Inquiry:**  
  "I wrote 12 unit tests using node --test. All tests pass with green checkmarks, but the terminal hangs and waits 30 seconds before closing instead of exiting immediately. I suspect the setTimeout watchdog timer in my controllerAdapter.js (which waits 5 seconds for hardware ACKs) is keeping the Node.js event loop active. How do I write a cleanup function to clear active timers in afterEach()?"
* **Discussion Summary:**  
  Identified active `setTimeout` handles registered in `controllerAdapter.js` and `trafficEngine.js` keeping the Node libuv event loop open.
* **Architectural Decision:**  
  Added tracking Maps (`pendingTimeouts`, `activeAutoAckTimers`) and exported `clearAllTimeouts()`. Added `afterEach()` teardown hooks in `trafficSystem.test.js` and `apiIntegration.test.js`, reducing test execution time from 30 seconds to ~300 milliseconds.

---

### Turn 6: Scoping & Trade-off Decisions (The 4–5 Hour Limit)
* **Candidate Inquiry:**  
  "The assessment instructions state: 'The expected effort is 4-5 hours. Completing every item is not required. Prioritize safety, correctness, and architecture. Clearly note incomplete features.' I have the core safety state machine, SQLite persistence, emergency preemption, controller watchdog, and tests working. I'm deciding whether to rush building dynamic junction creation (POST /api/junctions) and out-of-order sequence packet buffers, or defer them to Phase 2 and document them in the README. Which decision demonstrates better engineering judgment for an intern?"
* **Discussion Summary:**  
  Evaluated the evaluation rubric. In safety-critical factory automation, a partially complete system that preserves state consistency, non-conflicting signals, and clean recoverability is vastly superior to a rushed, visually complete system with fragile network logic.
* **Architectural Decision:**  
  Scoped the implementation strictly to Junction A. Implemented `POST /api/junctions` returning HTTP `501 Not Implemented`. Documented all 7 deferred items in Section 10 of `README.md`.

---

## 3. Summary of Candidate Verification
All code generated or refined with AI assistance was:
1. Validated against safety invariants via 12 automated unit and integration tests.
2. Verified for crash survivability by restarting the server against SQLite.
3. Inspected for code readability, clean modularity, and absence of external boilerplate frameworks.
