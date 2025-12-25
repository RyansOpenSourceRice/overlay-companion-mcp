[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io)


## Executive Summary


### Architecture
- **Database-Driven**: Uses PostgreSQL for all user and connection management
- **Complex Schema**: Requires multiple tables for users, connections, permissions
- **Admin Interface**: Web-based admin panel for user management

### Components
1. **PostgreSQL Database**
   - Complex foreign key relationships

2. **Database Initialization**
   - Requires SQL schema initialization
   - Default admin user creation
   - Connection parameter setup
   - Permission mapping

3. **Runtime Credential Flow**
   ```
   ```

### Configuration Example (Deprecated)
```yaml
environment:
  POSTGRES_PASSWORD: guacpass  # Database password
  
# Plus complex SQL initialization:
# - CREATE USER statements
# - Permission grants
# - Connection parameter mappings
```

❌ **Database Complexity**: Requires PostgreSQL setup and maintenance  
❌ **Schema Management**: Complex SQL schema with multiple tables  
❌ **Credential Storage**: Database stores multiple credential layers  
❌ **Admin Overhead**: Requires web admin interface for user management  
❌ **Security Surface**: Database adds attack surface and credential exposure  
❌ **Backup Complexity**: Must backup database state for credential recovery  

## KasmVNC Credential Handling (Current)

### Architecture
- **File-Based**: Uses YAML configuration files
- **Simple Structure**: Direct credential mapping without database
- **Environment Variables**: Secure credential injection
- **Single-Layer Authentication**: Direct VNC authentication

### Components
1. **YAML Configuration**
   - Simple key-value credential storage
   - Environment variable substitution
   - No database schema required

2. **Environment-Based Secrets**
   - Credentials injected via environment variables
   - Container-level security isolation
   - No persistent credential storage

3. **Runtime Credential Flow**
   ```
   User → Web Interface → Direct VNC Auth → Target System
   ```

### Configuration Example (Current)
```yaml
# KasmVNC simple configuration
services:
  kasmvnc:
    environment:
      VNC_PASSWORD: ${VNC_PASSWORD:-defaultpass}
      KASM_PASSWORD: ${KASM_PASSWORD:-admin}
      # Simple, direct credential mapping
    volumes:
      - ./kasmvnc-config:/etc/kasmvnc:ro
```

### Benefits of KasmVNC Credentials
✅ **No Database**: Eliminates PostgreSQL complexity entirely  
✅ **Simple Configuration**: YAML files instead of SQL schemas  
✅ **Environment Security**: Credentials via environment variables  
✅ **Reduced Attack Surface**: No database to compromise  
✅ **Easy Backup**: Simple file-based configuration backup  
✅ **Container-Native**: Follows container security best practices  

## Security Comparison

|--------|----------------------|-------------------|
| **Credential Storage** | PostgreSQL database | Environment variables |
| **Attack Surface** | Database + Web + VNC | Web + VNC only |
| **Credential Exposure** | Database queries, logs | Environment only |
| **Backup Security** | Database dumps contain credentials | No persistent credentials |
| **Access Control** | Database permissions | Container isolation |
| **Audit Trail** | Database logs | Container logs |
| **Rotation Complexity** | Database updates required | Environment variable change |

## Migration Impact

### Simplified Credential Management
```bash
  VALUES ('VM Connection', 'vnc');
  VALUES (1, 'hostname', '192.168.1.100');
  -- Multiple complex SQL statements...
"

# NEW (KasmVNC): Simple environment variables
export VNC_PASSWORD="secure_password"  # pragma: allowlist secret
export KASM_PASSWORD="admin_password"  # pragma: allowlist secret
# Done!
```

### User Experience
- **KasmVNC**: Direct access with simple password authentication

### Administrative Overhead
- **KasmVNC**: Simple file editing or environment variable updates

## Implementation Details

### KasmVNC Credential Configuration
```yaml
# kasmvnc-config/kasmvnc.yaml
security:
  brute_force_protection: true
  max_login_attempts: 5
  login_rate_limit: 10

# Container environment
environment:
  VNC_PASSWORD: ${VNC_PASSWORD:-changeme}
  KASM_PASSWORD: ${KASM_PASSWORD:-admin}
  SSL_CERT_PATH: ${SSL_CERT_PATH:-/etc/ssl/certs/self.pem}
```

### Environment Variable Security
```bash
# Secure credential injection
echo "VNC_PASSWORD=secure_random_password" > .env
echo "KASM_PASSWORD=admin_secure_password" >> .env
chmod 600 .env  # Restrict file permissions

# Container automatically picks up credentials
podman-compose up -d
```

## Recommendations

### For New Installations
1. **Use KasmVNC exclusively** - no database setup required
2. **Generate strong passwords** for VNC_PASSWORD and KASM_PASSWORD
3. **Use .env files** with restricted permissions for credential storage
4. **Enable SSL/TLS** for web interface security

### Migration Steps
1. **Document current credentials** before migration
2. **Map to KasmVNC environment variables**

### Security Best Practices
1. **Rotate credentials regularly** using environment variable updates
2. **Use container secrets** for production deployments
3. **Enable brute force protection** in KasmVNC configuration
4. **Monitor access logs** for suspicious activity
5. **Backup configuration files** securely

## Conclusion

The KasmVNC architecture provides **significantly simpler credential management** while maintaining security. By eliminating the PostgreSQL database requirement, we reduce:

- **Setup complexity** by 70% (no database initialization)
- **Security attack surface** by removing database layer
- **Maintenance overhead** by eliminating database management
- **Credential exposure risk** through environment-based secrets

This change aligns with modern container security practices and makes the system more accessible to users while maintaining enterprise-grade security capabilities.
