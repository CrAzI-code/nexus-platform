
# NEXUS — Engineering Instructions

## 1. Project Overview

NEXUS is a real-time team collaboration and
workflow management platform.

Users will be able to:
- Create organizations.
- Invite team members.
- Manage projects.
- Create and assign tasks.
- Communicate in real time.
- Share files.
- Track project activity.
- Automate workflows.

The goal is to build a maintainable,
secure and production-quality application.

## 2. Engineering Philosophy

Act as a senior software engineer.

However, explain implementations in a way
that a beginner developer can understand.

Prioritize:
- Correctness.
- Security.
- Maintainability.
- Simplicity.
- Reliability.
- Clear documentation.

Do not generate large amounts of code
without understanding the requirements.

## 3. Approved Technology Stack

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS

Backend:
- Node.js
- NestJS
- TypeScript

Database:
- PostgreSQL
- Prisma

Development:
- Git and GitHub
- npm workspaces
- Docker

Do not introduce new major dependencies
without explaining why and obtaining approval.

Always inspect installed package versions
before using a library.

## 4. Architecture Rules

Use a modular monolith initially.

Keep frontend and backend separate.

Backend responsibilities:
- Controllers handle HTTP requests.
- Services handle application operations.
- Business rules must remain organized.
- Database access must follow established patterns.
- Modules must have clear responsibilities.

Do not introduce microservices without
an approved architectural decision.

## 5. Coding Standards

- Use strict TypeScript.
- Avoid unnecessary use of any.
- Write readable and maintainable code.
- Avoid duplicated business logic.
- Use meaningful names.
- Keep functions focused.
- Avoid unnecessary abstractions.
- Do not rewrite unrelated files.

## 6. Security Rules

- Never trust frontend authorization.
- Validate all external input on the backend.
- Enforce organization-level access control.
- Prevent access to another organization's data.
- Never store plaintext passwords.
- Never expose secrets in frontend code.
- Never commit real environment secrets.
- Do not log passwords, tokens or sensitive data.
- Use secure authentication and session handling.

## 7. Database Rules

- PostgreSQL is the primary database.
- Use Prisma for database access.
- Version-control database migrations.
- Use transactions when operations require atomicity.
- Use foreign keys and appropriate constraints.
- Never run destructive database commands
  without explicit approval.
- Never run tests against production data.

## 8. Testing Requirements

Write tests for new functionality.

Where appropriate, include:
- Unit tests.
- Integration tests.
- End-to-end tests.
- Authorization tests.
- Failure scenario tests.

Never remove a failing test simply to
make the test suite pass.

Never claim a test passed unless it ran.

## 9. AI Development Workflow

Before implementing a significant feature:

1. Read this file.
2. Inspect the existing project.
3. Understand the requirements.
4. Identify affected files.
5. Explain the proposed implementation.
6. Identify security and failure risks.
7. Define acceptance criteria.
8. Obtain approval before major changes.

After implementation:

1. Review the changed files.
2. Run relevant tests.
3. Run type checking and linting.
4. Review the final Git diff.
5. Explain what changed.
6. Report anything not tested.

## 10. Dependency Management

Do not install new packages without
explaining their purpose and obtaining approval.

Do not upgrade existing dependencies
without approval.

Prefer existing project capabilities
before introducing additional tools.

## 11. Destructive Actions

Never perform these actions without
explicit user approval:

- Delete project files.
- Delete database volumes.
- Reset databases.
- Run destructive migrations.
- Force-push Git history.
- Delete cloud resources.
- Deploy to production.
- Modify production secrets.

## 12. Definition of Done

A feature is not complete simply because
the code has been generated.

Before declaring a feature complete:

- Acceptance criteria must be satisfied.
- Relevant tests must pass.
- Type checking must pass.
- Linting must pass.
- Security implications must be reviewed.
- Relevant documentation must be updated.
- Remaining limitations must be disclosed.

Always explain important engineering
decisions to the developer.
