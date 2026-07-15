# Job Board Integrations (V2 Roadmap)

**Status: V1 uses manual briefing fallback for all external job boards.**

This document explains the current state of external candidate sourcing integrations and what's needed to enable them in V2.

---

## Overview

The Recruiter Employee searches for candidates in three stages (§7.3–§7.4 of the spec):

1. **Internal sourcing** (always enabled): candidates from Smarter API + local talent database
2. **External sourcing** (V2 feature, with official APIs): Indeed, Infojobs Brasil, LinkedIn Recruiter
3. **Manual briefing fallback** (V1): when internal candidates < 8, generate structured boolean search strings for human execution

When internal sourcing yields fewer than 8 qualified candidates, the Recruiter generates a **sourcing briefing** with:
- Boolean search strings ready to paste into Indeed/Infojobs
- Filter recommendations (city, modality, semester range, etc.)
- Screening hints to validate candidates

The human recruiter executes the search on these platforms, then uploads found candidates to the talent database (source: `'manual'`). The Recruiter then assumes contact, screening, and ranking automatically.

---

## Current Status (V1)

### Indeed

**Viability:** ❌ **NOT VIABLE** without paid partnership

**Reason:**
- Indeed **deprecated the Publisher API (Job Search)** in 2023
- No public API exists for candidate database search
- "Indeed Smart Sourcing" is a **paid employer product** (UI-only, not programmable)
- Retrieve Candidates API exists but only receives candidates who already applied via Indeed Apply
- Scraping or account automation violates Terms of Use → **prohibited**

**Current behavior:** Sourcing briefing (manual fallback).

**Path forward (V2):** 
- Contact Indeed sales for partner program eligibility
- Evaluate "Talent Marketplace" or similar paid solutions if available
- Timeline: depends on commercial negotiation, not technical implementation

---

### Infojobs Brasil

**Viability:** ⚠️ **REQUIRES COMMERCIAL AGREEMENT**

**Reason:**
- Infojobs **does not expose a public API** for employer candidate search
- Developer docs at `developer.infojobs.net` cover candidate-side operations only (OAuth2 authenticated, role_candidate)
- Candidate database access exists only via Infojobs' proprietary ATS (PandaPé) or direct partnership
- Scraping or third-party aggregators (Apify) violate Terms of Use → **prohibited**

**Current behavior:** Sourcing briefing (manual fallback).

**Path forward (V2):**
1. Infojobs Brasil team contact: investigate "Selection" or employer partner APIs
2. Negotiate data-sharing agreement for candidate database access
3. If partnership approved: implement via `InfojobsProvider` class in `apps/web/src/lib/recruiter/job-boards.ts`
4. Timeline: depends on commercial negotiation + Infojobs' willingness to open API

**Infojobs dev documentation:** https://developer.infojobs.net/documentation/

---

### LinkedIn Recruiter

**Viability:** ⚠️ **POSSIBLE, WITH COMMERCIAL PARTNERSHIP**

**Note:** Not covered in V1 research. Likely requires LinkedIn Talent Solutions partnership (paid). To explore in future sprints.

---

## Code Structure (V1 + V2 Ready)

### File: `apps/web/src/lib/recruiter/job-boards.ts`

Defines the `JobBoardProvider` interface:

```typescript
export interface JobBoardProvider {
  readonly name: string
  isAvailable(): boolean  // true if credentials/partnership configured
  searchCandidates(job: JobOpening): Promise<JobBoardSearchOutcome>
}

export type JobBoardSearchOutcome =
  | { kind: 'candidates'; provider: string; candidates: ExternalCandidateResult[] }
  | { kind: 'manual_briefing'; provider: string; briefing: SourcingBriefing }
```

**Implemented providers:**
- `ManualBriefingProvider` (V1, always available)
- `IndeedProvider` (placeholder, awaits API + `INDEED_API_KEY` env)
- `InfojobsProvider` (placeholder, awaits API + `INFOJOBS_API_URL`/`INFOJOBS_API_KEY` envs)

**How it works:**

When sourcing finds < 8 qualified candidates, `sourcing-engine.ts` calls `getJobBoardProviders()` to iterate through registered providers in order:

```typescript
for (const provider of getJobBoardProviders()) {
  if (!provider.isAvailable()) continue  // skip if no credentials
  const outcome = await provider.searchCandidates(job)
  
  if (outcome.kind === 'manual_briefing') {
    // Send briefing to org owner
  } else if (outcome.kind === 'candidates') {
    // V2: materialize candidates and re-run ranking
  }
}
```

---

## To Enable Indeed (V2)

### Prerequisites

1. **Partnership approval** from Indeed sales
2. API credentials (if available — unlikely given deprecation)

### Setup

Once credentials are available:

1. Set environment variables:
   ```bash
   INDEED_API_KEY=your-indeed-partner-key
   ```

2. Uncomment/implement `IndeedProvider.searchCandidates()` in `job-boards.ts`

3. Call Indeed's official API (if available) to search candidates matching `job.profile`

4. Return `{ kind: 'candidates', provider: 'indeed', candidates: [...] }`

5. Candidates are materialized into the `candidates` table (source: `'indeed'`) and re-ranked

---

## To Enable Infojobs (V2)

### Prerequisites

1. **Commercial agreement** with Infojobs Brasil
2. API endpoint URL and authentication credentials
3. Documentation of available search parameters

### Setup

Once agreement is signed:

1. Set environment variables:
   ```bash
   INFOJOBS_API_URL=https://api.infojobs.com.br/...  # provided by Infojobs
   INFOJOBS_API_KEY=your-infojobs-partner-key
   ```

2. Implement `InfojobsProvider.searchCandidates()` in `job-boards.ts` to:
   - Build request with job profile (course, city, skills, etc.)
   - Call Infojobs API with credentials
   - Parse response and normalize to `ExternalCandidateResult[]`
   - Return `{ kind: 'candidates', provider: 'infojobs', candidates: [...] }`

3. Candidates are materialized into the `candidates` table (source: `'infojobs'`) and re-ranked

4. **LGPD compliance:** First message to candidate always includes:
   - That they were found via Infojobs partnership
   - Explicit opt-out option (§18 of spec)
   - Link to privacy policy

---

## Testing Manual Briefing (V1)

To test the fallback behavior:

1. Create a job opening with a profile
2. Add < 8 internal candidates matching it
3. Trigger sourcing
4. Recruiter should generate a sourcing briefing and email it to org owner
5. Verify boolean search strings are formatted correctly for Indeed/Infojobs

---

## Fallback Behavior (Always Available)

If no provider has credentials, or all return manual briefing, the Recruiter:

1. Generates structured boolean search strings
2. Formats filter recommendations
3. Sends briefing via email to org owner
4. Logs decision with reasoning
5. **Waits** for human to find and upload candidates manually

This ensures the process never fails silently — transparency is guaranteed.

---

## LGPD and Compliance Notes

- **Consent:** Candidates from external sources must have consent for contact in the source system (or explicit opt-in when contacted by the Recruiter for the first time)
- **Transparency:** First message always identifies source and offers opt-out
- **Minimal data:** Only name, email, phone, city, course, skills, resume URL — no SSN, birth date, passport, etc.
- **Deduplication:** If candidate exists in multiple sources, the richest record is kept and histories are merged

---

## Roadmap

- **V1 (now):** Manual briefing only (no automatic external API calls)
- **V2 (next):** Infojobs official API (if partnership available) + Indeed re-evaluation
- **V3 (later):** LinkedIn Recruiter, multi-language support, auto-refresh of external candidate profiles
