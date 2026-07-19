# Task 1: Store layer for tracking and match queue - Report

## Summary

Completed TDD implementation of CS2 tracking and match queue functionality in the store layer. All tests pass (141 total), typecheck clean, and code committed.

## What Was Done

1. **Test-First Approach**: Created `tests/store/inMemoryStore.cs2.test.ts` with 10 comprehensive tests covering both CS2 tracking and match queue functionality.

2. **Type Definitions**: Added `Cs2Tracking` interface and 7 new store methods to `src/store/types.ts`:
   - `setCs2Tracking()` - upsert tracking record
   - `getCs2Tracking()` - retrieve by chat/user
   - `deleteCs2Tracking()` - delete record
   - `listActiveCs2Tracking()` - list only active records
   - `updateCs2TrackingCode()` - update share code
   - `markCs2TrackingBroken()` - mark as broken
   - `enqueueMatch()` - add/merge matches to queue

3. **InMemoryStore Implementation** (`src/store/inMemoryStore.ts`):
   - Added private maps: `cs2Tracking` and `matchQueue`
   - Implemented all 7 methods using in-memory storage with memberKey helper

4. **SupabaseStore Implementation** (`src/store/supabaseStore.ts`):
   - Implemented all 7 methods with proper Supabase client calls
   - Added `rowToCs2Tracking()` mapping function
   - Proper error handling consistent with existing patterns

5. **Database Schema**:
   - Created migration: `supabase/migrations/20260719120000_cs2_match_detection.sql`
   - Updated: `supabase/schema.sql` with two new tables and RLS configuration
   - Tables: `cs2_tracking` (chat_id + user_id key) and `match_queue` (chat_id + share_code uniqueness)

## Test Results

### Step 2: Initial test run (expected to fail)
```
10 failed (10)
→ store.setCs2Tracking is not a function
→ store.getCs2Tracking is not a function
→ store.enqueueMatch is not a function
```
All methods reported as "not a function" as expected - TDD baseline established.

### Step 5: Post-implementation test run
```
tests/store/inMemoryStore.cs2.test.ts (10 tests)
✓ InMemoryStore cs2 tracking > sets and gets a tracking row
✓ InMemoryStore cs2 tracking > returns undefined for unknown tracking
✓ InMemoryStore cs2 tracking > deletes a tracking row
✓ InMemoryStore cs2 tracking > lists only active tracking rows across chats
✓ InMemoryStore cs2 tracking > advances the last share code
✓ InMemoryStore cs2 tracking > marks tracking broken
✓ InMemoryStore cs2 tracking > re-enrolling resets a broken row to active
✓ InMemoryStore match queue > inserts a new match
✓ InMemoryStore match queue > merges a duplicate match in the same chat
✓ InMemoryStore match queue > treats the same code in a different chat as a new match
```
All 10 tests passed.

### Step 8: Full test suite
```
npm run typecheck: PASSED (0 errors)
npm test: 141 tests passed (19 test files)
```

Notably:
- All existing tests remain passing (no regressions)
- New CS2 tests included in the 141 total
- TypeScript compilation clean (no type errors)

## Implementation Details

### CS2 Tracking Storage
- Scoped per (chat_id, user_id) pair using `memberKey()` helper
- Tracks active/broken status for AI-detected matches
- Stores authCode and lastShareCode for match detection flow
- `listActiveCs2Tracking()` filters to active records only for polling

### Match Queue Storage
- Unique key per (chat_id, share_code) pair
- Merges duplicate reports: same share code in same chat consolidates playerIds
- Different chats or different codes create separate queue entries
- Uses Set deduplication internally (InMemory) and spread operator (Supabase)

### Database Design
- `cs2_tracking`: Composite primary key on (chat_id, user_id)
- `match_queue`: Auto-incrementing id with unique constraint on (chat_id, share_code)
- Both tables have RLS enabled per existing pattern
- Proper status fields and timestamp tracking in queue

## Concerns

None. The implementation is complete, tested, and ready for Tasks 3 and 4 which depend on this store layer.

## Files Modified/Created
- `src/store/types.ts` - added Cs2Tracking interface + 7 methods
- `src/store/inMemoryStore.ts` - added cs2Tracking and matchQueue maps + 7 implementations
- `src/store/supabaseStore.ts` - added 7 methods + rowToCs2Tracking helper
- `supabase/schema.sql` - added cs2_tracking and match_queue tables + RLS
- `supabase/migrations/20260719120000_cs2_match_detection.sql` - new migration file
- `tests/store/inMemoryStore.cs2.test.ts` - new test file (10 tests)

## Commit

```
commit a081fb8
Author: OUAlieksieiev
Date: 2026-07-19

    feat: add cs2 tracking and match queue to the store layer

    - Add Cs2Tracking interface to types
    - Add 7 store methods for tracking and queue management
    - Implement all methods in InMemoryStore (using Map)
    - Implement all methods in SupabaseStore (using Supabase queries)
    - Add cs2_tracking and match_queue tables to schema
    - Add comprehensive test suite for InMemoryStore CS2 operations
```
