# inverse-data

A set of jobs for complex queries for https://inverse.finance/ and store them in a dynamo table for access by `inverse-api`

#### Current Jobs
- `proposals` - Get proposals and voters; runs hourly
- `delegates` - Get delegates, delegators, and votes by delegates; runs hourly
