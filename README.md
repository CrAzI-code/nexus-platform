
# NEXUS

### Real-Time Team Collaboration and Workflow Platform

NEXUS is a full-stack collaboration platform
designed to help teams manage projects,
tasks, communication and workflows in one place.

The goal is to build a secure, maintainable
and production-quality software application.

## Project Status

🚧 Currently under development.

This project is being built feature by feature,
with an emphasis on learning professional
software engineering practices.

## Core Features

Planned features include:

- User registration and authentication
- Organization and team management
- Role-based access control
- Project management
- Task creation and assignment
- Real-time team messaging
- Notifications
- File sharing
- Activity tracking
- Workflow automation
- Project analytics

## Technology Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend

- Node.js
- NestJS
- TypeScript

### Database and Infrastructure

- PostgreSQL
- Prisma
- Docker
- Redis (planned)
- AWS (planned)

## Architecture

NEXUS will initially use a modular monolith
architecture.

The frontend and backend will be maintained
as separate applications within one repository.

Microservices will only be considered when
there is a clear technical requirement.

## Development Principles

This project prioritizes:

- Security
- Maintainability
- Reliability
- Automated testing
- Clear architecture
- Database integrity
- Performance
- Good developer experience

AI-assisted development will follow
the engineering rules defined in AGENTS.md.

## Repository Structure

```text
nexus-platform/
├── apps/
│   ├── web/
│   └── api/
├── packages/
├── docs/
├── infrastructure/
├── AGENTS.md
└── README.md
```

This structure will be populated as development
progresses.

## Getting Started

### Local development

1. Install the dependencies with `npm install` and start the PostgreSQL
   development database using `docker compose up -d postgres`. To start local
   S3-compatible file storage and malware scanning, follow
   [the local infrastructure guide](./docs/local-infrastructure.md).
2. Create `apps/api/.env` from the safe placeholders in `.env.example` (do not
   overwrite an existing local environment file). Configure the database and
   Clerk values required by the API. Add `FILE_STORAGE_PATH=./private-files`
   and `FILE_MAX_UPLOAD_BYTES=10485760` if they are not already present.
3. Apply pending local schema migrations from the API workspace:

   ```powershell
   Set-Location .\apps\api
   npx prisma migrate deploy --config prisma7.config.ts
   ```

   The file-sharing migration is named
   `20261102194218_file_sharing`. Review the migration and confirm the target is
   a local development database before applying it.
4. Start the API and frontend in separate terminals:

   ```powershell
   npm run start:dev --workspace=apps/api
   npm run dev --workspace=apps/web
   ```

The local API stores file bytes under `apps/api/private-files` by default.
This directory is private, ignored by Git, and must not be moved under
`apps/web/public`. Uploads are limited to 10 MiB by default; the API accepts a
configured limit up to 25 MiB. Local filesystem storage is for development
only; production needs a durable private storage provider shared by API
instances, encryption, backups/retention, malware scanning, and orphan cleanup.

## Development Roadmap

- [ ] Engineering foundation
- [ ] Frontend setup
- [ ] Backend setup
- [ ] Database integration
- [ ] Authentication
- [ ] Organization management
- [ ] Project management
- [ ] Task management
- [ ] Real-time communication
- [ ] Notifications
- [ ] Cloud deployment
- [ ] Production readiness

## License

License to be determined.
