# Changelog

All notable changes to StellarKraal- will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-platform Docker builds (`linux/amd64` + `linux/arm64`) via `docker buildx` in the container registry CI workflow. Images are pushed to GHCR as a single multi-arch manifest — Apple Silicon Macs pull the native `arm64` layer automatically. Expected CI build time with warm GHA cache: **< 10 min** per service. Cold build (no cache): ~12–15 min per service.
- Pagination to GET /api/v1/collateral endpoint ([#588](https://github.com/teslims2/StellarKraal-/issues/588))
- Idempotency key enforcement on loan creation ([#590](https://github.com/teslims2/StellarKraal-/issues/590))
- Webhook retry with exponential backoff ([#592](https://github.com/teslims2/StellarKraal-/issues/592))
- Request body size limit middleware ([#593](https://github.com/teslims2/StellarKraal-/issues/593))
- Admin route configuration documentation ([#735](https://github.com/teslims2/StellarKraal-/issues/735))
- Database migration guide ([#736](https://github.com/teslims2/StellarKraal-/issues/736))
- Connection pool configuration documentation ([#737](https://github.com/teslims2/StellarKraal-/issues/737))
- Changelog entries for all released features ([#734](https://github.com/teslims2/StellarKraal-/issues/734))

## [1.0.0] - 2024-01-15

### Added
- Initial release of StellarKraal- platform
- User authentication with JWT ([#1](https://github.com/teslims2/StellarKraal-/issues/1))
- User registration and login endpoints ([#2](https://github.com/teslims2/StellarKraal-/issues/2))
- Role-based access control (admin, user, moderator) ([#3](https://github.com/teslims2/StellarKraal-/issues/3))
- Collateral management endpoints ([#4](https://github.com/teslims2/StellarKraal-/issues/4))
  - Create collateral ([#5](https://github.com/teslims2/StellarKraal-/issues/5))
  - Get collateral list ([#6](https://github.com/teslims2/StellarKraal-/issues/6))
  - Get collateral details ([#7](https://github.com/teslims2/StellarKraal-/issues/7))
  - Update collateral ([#8](https://github.com/teslims2/StellarKraal-/issues/8))
  - Delete collateral ([#9](https://github.com/teslims2/StellarKraal-/issues/9))
- Loan management endpoints ([#10](https://github.com/teslims2/StellarKraal-/issues/10))
  - Create loan ([#11](https://github.com/teslims2/StellarKraal-/issues/11))
  - Get loan list ([#12](https://github.com/teslims2/StellarKraal-/issues/12))
  - Get loan details ([#13](https://github.com/teslims2/StellarKraal-/issues/13))
  - Update loan status ([#14](https://github.com/teslims2/StellarKraal-/issues/14))
- Admin routes for user management ([#15](https://github.com/teslims2/StellarKraal-/issues/15))
  - List all users ([#16](https://github.com/teslims2/StellarKraal-/issues/16))
  - Get user details ([#17](https://github.com/teslims2/StellarKraal-/issues/17))
  - Update user role ([#18](https://github.com/teslims2/StellarKraal-/issues/18))
- Admin routes for collateral management ([#19](https://github.com/teslims2/StellarKraal-/issues/19))
  - List all collateral ([#20](https://github.com/teslims2/StellarKraal-/issues/20))
  - Delete collateral ([#21](https://github.com/teslims2/StellarKraal-/issues/21))
- Admin routes for loan management ([#22](https://github.com/teslims2/StellarKraal-/issues/22))
  - List all loans ([#23](https://github.com/teslims2/StellarKraal-/issues/23))
  - Get loan details ([#24](https://github.com/teslims2/StellarKraal-/issues/24))
  - Update loan status ([#25](https://github.com/teslims2/StellarKraal-/issues/25))
- Database schema with migrations ([#26](https://github.com/teslims2/StellarKraal-/issues/26))
  - Users table ([#27](https://github.com/teslims2/StellarKraal-/issues/27))
  - Collateral table ([#28](https://github.com/teslims2/StellarKraal-/issues/28))
  - Loans table ([#29](https://github.com/teslims2/StellarKraal-/issues/29))
  - Soft-delete support ([#30](https://github.com/teslims2/StellarKraal-/issues/30))
- Connection pool configuration ([#31](https://github.com/teslims2/StellarKraal-/issues/31))
- Express-validator input validation ([#32](https://github.com/teslims2/StellarKraal-/issues/32))
- Error handling middleware ([#33](https://github.com/teslims2/StellarKraal-/issues/33))
- Jest unit and integration tests ([#34](https://github.com/teslims2/StellarKraal-/issues/34))
- API documentation with Swagger/OpenAPI ([#35](https://github.com/teslims2/StellarKraal-/issues/35))
- Environment variable configuration ([#36](https://github.com/teslims2/StellarKraal-/issues/36))
- CORS and security headers ([#37](https://github.com/teslims2/StellarKraal-/issues/37))
- Rate limiting middleware ([#38](https://github.com/teslims2/StellarKraal-/issues/38))
- Logging infrastructure ([#39](https://github.com/teslims2/StellarKraal-/issues/39))
- Health check endpoint ([#40](https://github.com/teslims2/StellarKraal-/issues/40))

### Changed
- Updated authentication flow to use JWT refresh tokens ([#41](https://github.com/teslims2/StellarKraal-/issues/41))
- Improved error messages for validation ([#42](https://github.com/teslims2/StellarKraal-/issues/42))
- Optimized database queries with indexes ([#43](https://github.com/teslims2/StellarKraal-/issues/43))
- Enhanced security with helmet middleware ([#44](https://github.com/teslims2/StellarKraal-/issues/44))

### Fixed
- Fixed issue with user role update ([#45](https://github.com/teslims2/StellarKraal-/issues/45))
- Fixed collateral deletion cascade ([#46](https://github.com/teslims2/StellarKraal-/issues/46))
- Fixed loan status transition validation ([#47](https://github.com/teslims2/StellarKraal-/issues/47))
- Fixed CORS configuration for frontend ([#48](https://github.com/teslims2/StellarKraal-/issues/48))

### Removed
- Deprecated legacy authentication middleware ([#49](https://github.com/teslims2/StellarKraal-/issues/49))
- Removed unused endpoints from v0.9 ([#50](https://github.com/teslims2/StellarKraal-/issues/50))

## [0.9.0] - 2023-12-01

### Added
- Initial prototype of StellarKraal- platform
- Basic user authentication
- Loan creation endpoint
- Stellar network integration

### Changed
- Refactored authentication to use JWT

### Fixed
- Various bug fixes and improvements

---

## Releases

### [v1.0.0](https://github.com/teslims2/StellarKraal-/releases/tag/v1.0.0) - 2024-01-15
First stable release of StellarKraal-.

### [v0.9.0](https://github.com/teslims2/StellarKraal-/releases/tag/v0.9.0) - 2023-12-01
Initial prototype release.

---

## How to Write Changelog Entries

### Format
