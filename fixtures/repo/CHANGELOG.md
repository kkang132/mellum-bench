# Changelog

## 2.0.0
- **Breaking**: `verifyToken` now throws `AuthError` instead of returning `false` on expiry.
- Token expiry is represented as ISO-8601 strings.

## 1.1.0
- Added per-IP **rate limit** to the login endpoint.
- Introduced `UserStore` for in-memory user lookups.

## 1.0.0
- **Initial release**: password hashing, token verification, basic user creation.
