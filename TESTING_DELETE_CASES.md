# Test Plan: Delete Cases Functionality

## Overview
Testing the new delete functionality for Cases in the web interface.

## Test Cases

### 1. Backend API Tests

#### Test 1.1: DELETE endpoint exists
- **Action**: Send DELETE request to `/v1/cases/{case_id}`
- **Expected**: 200 OK with `{ status: 'deleted' }`
- **Verification**: Case lifecycle is set to 'void' in database

#### Test 1.2: DELETE requires authentication
- **Action**: Send DELETE request without auth token
- **Expected**: 401 Unauthorized

#### Test 1.3: DELETE validates case ownership
- **Action**: Try to delete a case from another organization
- **Expected**: 404 Not Found or 403 Forbidden

#### Test 1.4: Void cases excluded from default list
- **Action**: GET `/v1/cases` without lifecycle filter
- **Expected**: Response excludes cases with lifecycle='void'

#### Test 1.5: Void cases included with filter
- **Action**: GET `/v1/cases?lifecycle=void`
- **Expected**: Response includes only void cases

### 2. Frontend Hook Tests

#### Test 2.1: useDeleteCase hook
- **Action**: Call `deleteCase(caseId)` mutation
- **Expected**: 
  - API DELETE request is sent
  - Cases list is invalidated on success
  - UI updates to remove deleted case

### 3. UI Tests

#### Test 3.1: Delete button appears on case cards
- **Action**: Navigate to /cases
- **Expected**: Each case card shows a trash icon button in top-right

#### Test 3.2: Delete button click shows confirmation
- **Action**: Click trash icon on a case
- **Expected**: Confirmation dialog appears with:
  - Case title
  - Warning message
  - Cancel button
  - Delete button (red/danger style)

#### Test 3.3: Cancel deletion
- **Action**: Open confirmation dialog, click Cancel
- **Expected**: Dialog closes, case remains in list

#### Test 3.4: Confirm deletion
- **Action**: Open confirmation dialog, click Delete
- **Expected**: 
  - Delete button shows "Deleting..." state
  - API request is sent
  - Dialog closes on success
  - Case disappears from list

#### Test 3.5: Delete button doesn't trigger navigation
- **Action**: Click delete button on case card
- **Expected**: Confirmation dialog opens, does NOT navigate to case detail

#### Test 3.6: Deleted cases hidden from list
- **Action**: Delete a case, refresh page
- **Expected**: Deleted case does not appear in list

### 4. Edge Cases

#### Test 4.1: Multiple rapid deletions
- **Action**: Click delete on multiple cases quickly
- **Expected**: Only one confirmation dialog at a time

#### Test 4.2: Delete while loading
- **Action**: Try to delete case while list is loading
- **Expected**: Delete button is disabled or not shown

#### Test 4.3: Network error during delete
- **Action**: Delete case with network offline
- **Expected**: Error message shown, case remains in list

## Manual Testing Checklist

- [ ] Start development servers: `npm run dev`
- [ ] Navigate to `/cases` in web browser
- [ ] Create a test case
- [ ] Verify delete button appears on case card
- [ ] Click delete button
- [ ] Verify confirmation dialog appears
- [ ] Test "Cancel" button
- [ ] Test "Delete" button
- [ ] Verify case disappears from list
- [ ] Refresh page and verify case stays deleted
- [ ] Check database: verify case has lifecycle='void'
- [ ] Test with multiple cases
- [ ] Test on mobile viewport (responsive design)

## Database Verification

```sql
-- Check that deleted case has lifecycle='void'
SELECT id, title, lifecycle FROM cases WHERE id = '<case-id>';

-- Check that CaseVoided event was created
SELECT * FROM events 
WHERE case_id = '<case-id>' 
  AND type = 'CaseVoided'
ORDER BY recorded_at DESC 
LIMIT 1;
```

## Expected Behavior Summary

1. **Soft Delete**: Cases are marked as void, not hard-deleted
2. **Event Sourcing**: CaseVoided event is appended to event log
3. **UI Update**: Case immediately removed from list view
4. **Audit Trail**: Event log maintains complete history
5. **Reversibility**: Cases can potentially be un-voided later
6. **Filter Behavior**: Void cases can be viewed with lifecycle=void filter

## Notes

- Delete uses `Case.Void` command (existing functionality)
- Implementation follows event sourcing pattern
- No cascading deletes required (void is a lifecycle state)
- Translation keys may need to be added for i18n
