# Implementation: Issues #1296, #1299, #1300, #1301

Overlay onto the SplitNaira repo.

## #1299 Collaborator invitation cancellation
- `backend/src/services/collaboration/invitation-registry.ts` – register / cancel / accept guards + cancel events
- `POST /auth/invitations` returns `invitationId` and tracks pending invites
- `POST /auth/invitations/:invitationId/cancel` – inviter-only cancellation
- `POST /auth/invitations/accept` rejects cancelled invites with **410 invitation_cancelled**
- Tests: `invitation-cancel.test.ts`

## #1300 Collaborator role permissions
- `backend/src/services/collaboration/permissions.ts` – roles `owner|admin|editor|viewer`, full permission matrix, `assertPermission`, `resolveCollaboratorRole`
- `GET /collaboration/permissions/matrix`
- Delete route enforces `project:delete` server-side
- Tests: `permissions-matrix.test.ts`

## #1301 Participant percentage validation UI
- `frontend/src/components/splits/ParticipantPercentageValidation.tsx`
- Live total %, invalid highlight, `shouldBlockSubmit()`
- Server basisPoints (sum 10000) remains authoritative
- Tests: `ParticipantPercentageValidation.test.ts`

## #1296 Project deletion safeguards
- `backend/src/services/collaboration/project-deletion.ts`
- Detects financial history; hard delete blocked → soft delete with confirmation phrase `DELETE PROJECT`
- Audit events preserved
- `POST /collaboration/projects/:projectId/delete`
- Tests: `project-deletion.test.ts`

## Verify
```bash
cd backend && npx vitest run src/services/collaboration
cd frontend && npx vitest run src/components/splits/ParticipantPercentageValidation.test.ts
```
