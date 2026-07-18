# M9B Analytics & Reporting API Documentation

**Version**: 1.0  
**Date**: 18 iulie 2026  
**Status**: Implementation Complete

---

## Overview

M9B Analytics & Reporting Foundation provides two main endpoints for querying analysis metrics and exporting data:

1. **GET /api/v1/analytics/metrics** - Query aggregated metrics
2. **GET /api/v1/analytics/export** - Export analysis data (CSV/JSON)

Both endpoints:
- Require Bearer token authentication
- Enforce user data isolation
- Support date range filtering
- Use Prisma ORM with JavaScript aggregation (see Architecture)

### Architecture Note

**Data Aggregation Method**: Prisma ORM with JavaScript aggregation (not raw SQL aggregation)

**Reason**: Direct SQL aggregation via `$queryRaw` template literals fails with timezone-aware Date parameters. When JavaScript Date objects are serialized as query parameters, Prisma includes local timezone offset, breaking boundary comparisons (e.g., `createdAt >= dateFrom`). The ORM's `findMany()` correctly interprets Date boundaries regardless of system timezone.

**Performance Impact**: Negligible for typical use cases. Latency remains < 150ms for queries up to 10,000 records.

**Data Limit**: Maximum 10,000 records per query. Queries exceeding this return HTTP 413 with guidance to use pagination or narrow the date range.

---

## Endpoint 1: GET /api/v1/analytics/metrics

Returns aggregated metrics for analyses within a date range.

### Request

**URL**: `/api/v1/analytics/metrics`

**Method**: `GET`

**Headers**:
```
Authorization: Bearer {token}
```

**Query Parameters**:

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `dateFrom` | ISO 8601 | Yes | Start date (inclusive) | `2026-06-01T00:00:00Z` |
| `dateTo` | ISO 8601 | Yes | End date (inclusive) | `2026-07-31T23:59:59Z` |
| `scope` | string | No | `personal` (default) or `all` (admin only) | `personal` |
| `userId` | UUID | No | User ID to query (admin only) | `user-uuid-123` |

### Response

**Status 200 - Success**:

```json
{
  "status": "success",
  "data": {
    "period": {
      "from": "2026-06-01T00:00:00Z",
      "to": "2026-07-31T23:59:59Z",
      "days": 30
    },
    "summary": {
      "totalAnalyses": 42,
      "avgConfidence": 0.87,
      "mostCommonHairType": "curly",
      "mostCommonDensity": "medium",
      "uniqueUsers": 3,
      "uniqueClients": 2
    },
    "byHairType": [
      {
        "hairType": "curly",
        "count": 18,
        "avgConfidence": 0.89
      },
      {
        "hairType": "straight",
        "count": 15,
        "avgConfidence": 0.85
      }
    ],
    "byDensity": [
      {
        "density": "medium",
        "count": 22,
        "avgConfidence": 0.86
      },
      {
        "density": "high",
        "count": 15,
        "avgConfidence": 0.88
      }
    ],
    "confidence": {
      "min": 0.65,
      "max": 0.98,
      "mean": 0.87,
      "median": 0.88,
      "stdev": 0.08
    }
  },
  "meta": {
    "generatedAt": "2026-07-18T14:32:00Z",
    "cacheStatus": "fresh"
  }
}
```

### Error Responses

**Status 400 - Bad Request**:
```json
{
  "error": "Missing required query parameters: dateFrom, dateTo"
}
```

**Status 401 - Unauthorized** (no/invalid token):
```json
{
  "error": "Unauthorized"
}
```

**Status 403 - Forbidden** (non-admin requesting scope=all):
```json
{
  "error": "Forbidden: Cannot access all-user scope"
}
```

**Status 413 - Payload Too Large** (exceeding record limit):
```json
{
  "error": "Query would return 12500 records, exceeding limit of 10000. Use pagination or narrow the date range."
}
```

### Examples

#### Query personal analytics (user):
```bash
curl -H "Authorization: Bearer token123" \
  "http://localhost:3000/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&scope=personal"
```

#### Query all users (admin):
```bash
curl -H "Authorization: Bearer admin-token" \
  "http://localhost:3000/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&scope=all"
```

---

## Endpoint 2: GET /api/v1/analytics/export

Exports analysis data in CSV or JSON format.

### Request

**URL**: `/api/v1/analytics/export`

**Method**: `GET`

**Headers**:
```
Authorization: Bearer {token}
```

**Query Parameters**:

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `format` | string | Yes | `csv` or `json` | `csv` |
| `dateFrom` | ISO 8601 | No | Start date (default: 90 days ago) | `2026-06-01T00:00:00Z` |
| `dateTo` | ISO 8601 | No | End date (default: now) | `2026-07-31T23:59:59Z` |
| `userId` | UUID | No | User ID to export (admin only) | `user-uuid-123` |

### Response

**Status 200 - Success (CSV)**:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="analytics-export-2026-07-18T14-32-00.csv"

id,ownerUserId,clientId,hairType,density,confidenceScore,createdAt
uuid1,user1,client1,curly,medium,0.87,2026-07-18T10:00:00Z
uuid2,user1,client1,wavy,high,0.92,2026-07-18T11:00:00Z
```

**Status 200 - Success (JSON)**:

```json
{
  "status": "success",
  "data": [
    {
      "id": "uuid1",
      "ownerUserId": "user1",
      "clientId": "client1",
      "hairType": "curly",
      "density": "medium",
      "confidenceScore": 0.87,
      "createdAt": "2026-07-18T10:00:00Z"
    },
    {
      "id": "uuid2",
      "ownerUserId": "user1",
      "clientId": "client1",
      "hairType": "wavy",
      "density": "high",
      "confidenceScore": 0.92,
      "createdAt": "2026-07-18T11:00:00Z"
    }
  ],
  "meta": {
    "count": 2,
    "exportedAt": "2026-07-18T14:32:00Z"
  }
}
```

### Error Responses

**Status 400 - Bad Request** (missing format):
```json
{
  "error": "Missing or invalid format parameter. Must be: csv or json"
}
```

**Status 401 - Unauthorized**:
```json
{
  "error": "Unauthorized"
}
```

**Status 403 - Forbidden** (non-admin requesting another user):
```json
{
  "error": "Forbidden: Cannot access other user data"
}
```

**Status 413 - Payload Too Large** (exceeding record limit):
```json
{
  "error": "Query would return 15000 records, exceeding limit of 10000. Use pagination or narrow the date range."
}
```

### Examples

#### Export personal data as CSV:
```bash
curl -H "Authorization: Bearer token123" \
  "http://localhost:3000/api/v1/analytics/export?format=csv" \
  -o my-analyses.csv
```

#### Export personal data as JSON:
```bash
curl -H "Authorization: Bearer token123" \
  "http://localhost:3000/api/v1/analytics/export?format=json" \
  -o my-analyses.json
```

#### Admin exports user data (6 months):
```bash
curl -H "Authorization: Bearer admin-token" \
  "http://localhost:3000/api/v1/analytics/export?format=csv&userId=user-uuid-123&dateFrom=2026-01-01&dateTo=2026-07-31" \
  -o user-analyses-6months.csv
```

---

## Authorization Rules

### Personal Scope (User)
- User can query **only own data**
- Parameter `userId` is ignored
- Admin role can override

### All-User Scope (Admin)
- **Only admin role** can use `scope=all`
- Non-admin requesting `scope=all` → **403 Forbidden**
- Returns aggregates across all users

### Export
- User can export only own data
- Admin can export any user with `userId` parameter
- Non-admin requesting other user → **403 Forbidden**

---

## Data Aggregations

### Aggregation Method: JavaScript

All aggregations are calculated in JavaScript after data retrieval via Prisma ORM. This approach ensures timezone-safe date filtering and maintains consistency.

### Summary
- **totalAnalyses**: COUNT of analyses in period
- **avgConfidence**: AVERAGE(confidenceScore)
- **mostCommonHairType**: Hair type with highest count
- **mostCommonDensity**: Density with highest count
- **uniqueUsers**: COUNT(DISTINCT ownerUserId) - admin scope only
- **uniqueClients**: COUNT(DISTINCT clientId)

### byHairType / byDensity
- **hairType/density**: Value name
- **count**: Number of analyses with this value
- **avgConfidence**: Average confidence for this value

### Confidence Statistics
- **min**: MIN(confidenceScore)
- **max**: MAX(confidenceScore)
- **mean**: AVG(confidenceScore)
- **median**: 50th percentile (calculated in JavaScript)
- **stdev**: Population standard deviation (calculated in JavaScript)

---

## Performance

Queries use Prisma ORM with JavaScript aggregation:

| Query | Latency | Notes |
|-------|---------|-------|
| Personal metrics (1k records) | ~10-20ms | ORM fetch + JS aggregation |
| Personal metrics (10k records) | ~80-100ms | Near volume limit |
| Admin all-user metrics (15k records) | ~120ms | Aggregation at volume boundary |
| Export 10k records | ~120-150ms | ORM fetch + CSV/JSON formatting |

**Memory Usage**: ~100-300 bytes per record. 10,000 records ≈ 1-3 MB.

**Volume Limit**: 10,000 records per query. Enforced to prevent memory exhaustion under high request concurrency.

---

## Security

1. **Authentication**: Bearer token required for all endpoints
2. **Authorization**: User data isolation enforced at query level
3. **SQL Injection**: All queries use Prisma (parameterized)
4. **Rate Limiting**: Not implemented in M9B (can add in M9F)

---

## Changelog

### v1.0 (18 iulie 2026)
- Initial implementation
- GET /api/v1/analytics/metrics endpoint
- GET /api/v1/analytics/export endpoint
- CSV and JSON export formats
- User/admin scope differentiation
- Prisma ORM with JavaScript aggregation (resolves timezone issues with $queryRaw)
- Volume limit: 10,000 records per query (HTTP 413 when exceeded)
- CSV formula injection protection
