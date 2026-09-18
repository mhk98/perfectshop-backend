## Role Menu Permissions

Backend now supports persistent, role-based menu permissions backed by the `RolePermission` table.

### Flow

- User logs in through `POST /api/v1/user/login`
- Login response now includes `menuPermissions` for the user's role
- `auth()` verifies the JWT and loads effective role permissions
- `requireMenuPermission("menu_key")` protects menu-scoped APIs
- If a role has no DB row yet, the server falls back to seeded default permissions

### Endpoints

- `GET /api/v1/role-permissions`
- `GET /api/v1/role-permissions/:role`
- `PUT /api/v1/role-permissions/:role`

Only `superAdmin` and `admin` can manage role permissions.

### Login Response

```json
{
  "success": true,
  "data": {
    "accessToken": "token_here",
    "user": {
      "Id": 1,
      "Email": "admin@example.com",
      "role": "admin"
    },
    "menuPermissions": ["overview", "inventory", "product"]
  }
}
```

### Notes

- Valid menu keys are defined in `app/enums/menuPermissions.js`
- Default role mappings live in `app/config/roleMenuPermissions.js`
- Protected routes can stack `auth()`, `requireRoles(...)`, and `requireMenuPermission(...)`
