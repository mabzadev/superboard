# OpenGrow iOS SDK

## Overview

OpenGrow is an iOS SDK library for deep linking, universal linking, in-app messaging, and event tracking. Distributed via SPM and CocoaPods. No external dependencies.

## Tech Stack

- **Language:** Swift 5.9+
- **Platform:** iOS 13.0+
- **UI:** UIKit with XIB files (not SwiftUI)
- **Package Managers:** SPM (primary), CocoaPods (secondary)
- **Testing:** XCTest with protocol-based mocking
- **Storage:** Keychain, UserDefaults, NSCoding-based DataCache
- **Networking:** URLSession with custom BaseService abstraction

## Architecture

**Pattern:** Service layer with static facade and protocol-based DI.

```
OpenGrow.swift (Public static facade)
  └── OpenGrowManager (Coordinator)
        ├── EventsHandler (Lifecycle event tracking)
        ├── PaymentEventsHandler (IAP & custom transactions)
        ├── APIService (REST client)
        └── Context (Session state)
```

All major components have protocol interfaces (`APIServiceProtocol`, `EventsStorageProtocol`, etc.) enabling mock-based unit testing.

## Project Structure

```
Sources/OpenGrow/
├── OpenGrow.swift                    # Public API facade (static methods)
├── controllers/                   # UIKit view controllers + XIBs
├── helpers/                       # UI helpers (alerts, presentation)
├── extensions/                    # UIKit extensions
├── view/                          # Table view cells
└── model/
    ├── OpenGrow.swift                # Duplicate name - main SDK entry
    ├── handlers/
    │   ├── OpenGrowManager.swift     # SDK coordinator
    │   ├── EventsHandler.swift    # Event dispatch (5s batching)
    │   ├── PaymentEventsHandler.swift
    │   └── Context.swift          # Global session state
    ├── service/
    │   ├── APIService.swift       # API endpoints + auth headers
    │   └── BaseService.swift      # URLSession abstraction + retries
    ├── helpers/                   # Storage, keychain, logging
    ├── data-cache/                # NSCoding persistence
    ├── entities/                  # Data models
    └── extensions/                # Foundation extensions

Tests/mbzadevsTests/
├── *Tests.swift                   # 20 unit test files
├── Mock*.swift                    # Protocol-based mocks
└── XCTestCase+Helpers.swift       # Test utilities
```

## Key Conventions

### Code Style
- **Naming:** CamelCase types, camelCase properties/methods
- **Organization:** `// MARK: - Section Name` in large files
- **Error handling:** Completion-based (no throws), guard for early returns
- **Memory:** Weak self in closures to prevent retain cycles
- **Threading:** DispatchQueue for background work, completions on main thread
- **Logging:** Use `DebugLogger` (never raw `print()`)

### Testing
- All handlers/services have protocol interfaces for mock injection
- Mocks are in `Tests/mbzadevsTests/Mock*.swift`
- No external test frameworks - plain XCTest only
- Tests create mocks inline, no shared test data factories
- DataCache does NOT auto-clear between tests - manage cleanup manually

### Build & Run
```bash
# Build
swift build

# Run tests
swift test

# Run specific test
swift test --filter OpenGrowManagerTests
```

## Important Gotchas

1. **Bundle.module:** Conditional compilation handles SPM (`Bundle.module`) vs Xcode project (`Bundle.framework`) for XIB resources
2. **Notification naming:** `OpenGrowNotification` (not `Notification`) to avoid Foundation namespace collision
3. **Event queuing:** Events created before SDK auth are held and linked once authenticated
4. **Request retries:** Failed network requests queue and retry on app reactivation
5. **Background sessions:** Separate URLSession instance for background requests with custom delegate
6. **NSCoding:** Events persist using NSCoding (legacy but stable pattern)
7. **Static facade:** `OpenGrowManager` is internal; public API is the static `OpenGrow` class only

## Branching

- **Main branch:** `main`
- **Active development:** `development/v2.x` branches
- **Feature branches:** `feature/*` (e.g., `feature/iap`)
- **Remotes:** `origin`, `internal`, `internal-sdk-on-opengrow`

## Git Commit Rules

- Keep commit messages concise and descriptive
- No AI attribution in commits or PRs
- Prefer small, focused commits over large changes
