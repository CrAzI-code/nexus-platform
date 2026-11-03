This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## NEXUS frontend architecture

The authenticated workspace uses the existing NestJS API clients in `src/lib` and
Clerk for session tokens. Shared NEXUS color and surface tokens live in
`src/app/globals.css`; responsive dashboard-shell styles live in
`src/app/dashboard.css`; reusable loading, empty, error, and status UI lives in
`src/components/ui`.

Dashboard counts are derived from the existing organization, project, task, and team
APIs. Recent organization activity uses the audit-log API and is shown only to roles
already authorized by the backend. Navigation must link only to real routes; Files and
Settings remain visibly unavailable until dedicated routes exist.

Authenticated organization pages share the persistent organization shell. Home links
use `/?organizationId=<id>` so dashboard navigation is direct and keeps organization
context without relying on browser history.

Run frontend checks from the repository root:

```bash
npm run lint --workspace=web
npm exec --workspace=web tsc -- --noEmit
npm run build --workspace=web
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
