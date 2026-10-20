# KUbeats — Client Change Requirements (authoritative, verbatim)

> This is the client's own wording. It is the single source of truth for scope.
> Implement ONLY what is written here. Nothing extra — no extra columns, fields,
> routes, pages, buttons, labels, tabs, menu items, comments or lines beyond what
> is stated, and no assumed additions. Use the exact names the client used.

## Admin & Team Lead

### 1. Admin Dashboard — Replace Pipeline by Rep with Activity Report
- Remove the Pipeline by Rep table from the Admin Dashboard.
- Display the existing Activity Report table on the Admin Dashboard in its place.
- Show institute-wise activity information, including activity types and their Open and Closed status counts.
- Include Meetings, Sessions, Campus Visits, Olympiad Registrations, Applications, and Admissions where applicable.
- Add a Date Filter and column sorting.
- Add a Download Excel button.
- The downloaded Excel file must contain the same data as the displayed table, including applied filters.
- If possible, make institute names and activity counts clickable.
- Clicking an institute name should open its activity details.
- Clicking an activity count should display the corresponding activity records.
- All counts must come from actual saved records.

### 2. Activity Report — Correct Activity-Wise Status Counting
- Calculate activity counts using the actual activity type and its current status.
- Display separate counts for Meetings, Sessions, Campus Visits, Olympiad Registrations, Applications, and Admissions.
- Show Open and Closed counts separately for each activity type.
- Count Meetings only under Meetings, Sessions only under Sessions, and Campus Visits only under Campus Visits.
- Do not classify activities only by institute or accidentally count one activity under another type.
- Show accurate activity-wise counts for every institute.
- Ensure overall totals match the sum of the corresponding activity counts.
- Apply the same counting logic to the Admin Dashboard, Activity Report, clickable details, filters, and Excel downloads.
- Example: 3 Meetings (2 Open, 1 Closed) + 2 Sessions (1 Open, 1 Closed) → Meetings: 2 Open, 1 Closed; Sessions: 1 Open, 1 Closed. Do not count the Meetings as Sessions.

### 3. Admin Review — Display Rep Call Reports
- Whenever a Rep logs a call and submits its report, display it in Admin → Review.
- Show Call Reports alongside existing Log Visit reports.
- Clearly identify each record as either a Call Report or a Log Visit Report.
- Display relevant details such as Rep name, institute name, call date, and submitted report information.
- Allow Admin to open and review the complete Call Report from the same Review section.
- Use the existing saved call record. Do not create duplicate reports.
- Ensure Admin can access reports submitted by all authorized Reps.

### 4. Admin Dashboard — Follow-Up Summary Cards
Add three summary cards at the top of the Admin Follow-up Owned page.
- Card 1: Total Follow-ups Owned — total number of follow-ups currently assigned to Reps; when clicked, show the complete list of owned follow-ups.
- Card 2: Total Follow-ups Missed — total number of follow-ups that have been missed; when clicked, show the complete list of missed follow-ups.
- Card 3: Total Follow-ups Closed — total number of follow-ups completed or closed; when clicked, show the complete list of closed follow-ups.
- For each list show: Rep name, Institute name, Follow-up date, Follow-up status.
- Counts must match the actual saved records and each card opens the corresponding filtered list.

### 5. Admin Team Tab — Search Rep by Name
Location: Admin Dashboard → Team tab.
- Add a search bar at the top of the existing Team tab.
- Allow Admin to search for a Representative (Rep) by name.
- Display matching Reps as Admin types.
- Show "No Rep found" when no matching user exists.
- Use the existing Team tab data and preserve all current team-management functionality.
- This search feature is for Admin, not a new search bar in the Team Lead section.

### 6. Admin — Assign Team Leads and Manage Team Institutes
- Allow Admin to assign Reps to a Team Lead.
- Allow Admin to add institutes to a Team Lead's team.
- Allow institutes from different campuses to belong to the same Team Lead's team.
- Do not restrict a Team Lead to institutes from only one campus.
- Allow Admin to manage team assignments when organizational responsibilities change.
- Display the assigned Reps and institutes to the relevant Team Lead.
- Ensure Team Leads can access only the Reps and institutes assigned to their teams.
- Preserve the institute's existing records, visit history, and activity information when its team assignment changes.

### 7. Admin Team Tab — Add Role Change to the Existing Edit Form
- Update the existing Edit form.
- Add a Role dropdown to the same form.
- Allow Admin to change a user's role, such as Rep to Team Lead or Team Lead to Rep, subject to the supported roles.
- Keep the existing Name and Campus editing fields unchanged.
- Save the updated role.
- Apply the correct permissions and dashboard access according to the new role.
- Preserve all existing activity records, institute history, and reports after the role change.
- Important: Do not create a separate Edit button or a separate form just for role changes. Add the Role dropdown to the existing Edit form.

### 8. Admin — Add New Target Statuses for Reps
- Provide an option in the Target section for Admin to add a new target status.
- Allow Admin to enter the new status name.
- Save the status so it becomes available in the relevant target workflow.
- Display the newly added status wherever target statuses are used.
- Ensure the new status is available to the appropriate Reps.
- Prevent duplicate or empty status names.
- The target status configuration must be connected to the actual application data rather than using temporary frontend-only values.

### 9. Settings — Custom Status and Status-Specific Fields
Create a Status Management section under Settings.
- Allow Admin to create new statuses.
- Allow Admin to define the information required for each status.
- Allow Admin to configure dropdown fields and their available options.
- Allow Admin to specify which fields are required for a particular status.
- Display the configured fields dynamically when that status is selected in the relevant form.
- Save the configuration so it remains available across sessions.
- Use the configured status and fields consistently in forms, tables, and reports.
- Allow Admin to manage status-specific information without requiring a code change for every new status.
- Example: if Admin creates a status that requires a Follow-up Date and Outcome dropdown, the relevant form should display those fields when that status is selected.
- Keep the configuration restricted to Admin and validate the configured fields before saving.

## Rep Side

### 1. Institute Tab — Institute-Wise Activity Details
In the Institute tab, show a complete activity summary for each institute.
- Display all relevant institute details.
- Show how many follow-ups are currently owned/pending for that institute.
- Show the number of meetings completed.
- Show the number of activities with Closed status and the number with Open status.
- Create a single institute-wise table for the Rep.
- Provide column sorting so the Rep can sort the table using the available columns.
- Add a Date Filter to the Institute tab so the Rep can filter records by date.

### 2. Target Tab — Admin Access to Add New Target Statuses
- Admin should have access to the complete Target tab.
- Provide an option for Admin to add new target statuses.
- Newly added target statuses should become available in the relevant target workflow.
- Ensure the new statuses are displayed consistently wherever target statuses are used.

### 3. Automatic Follow-Up in Daily Plan
- Automatically add follow-ups according to their scheduled date.
- Automatically display today's follow-ups in Today's Plan.
- The Rep should only need to check in and complete the required activity.
- Existing past follow-ups should also be added to the relevant plan/list so they are not missed.
- Avoid creating duplicate follow-up entries when the same follow-up already exists.

### 4. Log Visit — Institute-Wise Open and Closed Statuses
- Display the status of the selected institute.
- For example, if the selected institute is Karnavati University Gandhinagar, show its current status.
- Provide the complete list of Open and Closed statuses.
- The status displayed must belong to the selected institute, not another institute.
- Ensure the status list is consistent with the institute's current status and the existing workflow.

### 5. Log Visit — Next Action for Closed Statuses
- For Open statuses, display the Next Action options: Call or Meeting.
- For Closed statuses, do not display the Next Action field.
- For the Not Interested status, do not display the Next Action field and do not create a new follow-up.
- If a follow-up already exists for an institute that is marked Not Interested, delete/cancel that follow-up so it no longer appears in the active follow-up list or Daily Plan.
- Preserve the institute and its historical activity records.

### 6. Pending Tab — Follow-Up Counts and Details
Display two summary cards:
- A. Total Number of Follow-ups Owned — total count of follow-ups currently assigned to the Rep; when clicked, show the complete list of those follow-ups.
- B. Total Number of Follow-ups Missed — total count of missed follow-ups; when clicked, show the complete list of missed follow-ups.
- The count and list must match the actual records. Only show follow-ups that the logged-in Rep is authorized to access.

### 7. Rep Activity Report — Institute-Wise Activity Summary
Replace the current view that only shows Check-In and Check-Out information with a complete institute-wise activity table. For each institute, display:
- Institute Name.
- Check-In Date and Time.
- Check-Out Date and Time.
- Location.
- Number of Open Status activities.
- Number of Closed Status activities.
- Total Number of Visits.
- Total Number of Meetings.
- Total activity count.
- Show the overall totals for the report as well.

## Changes Given by IQcity (UWSB) Campus

### 1. Admin Delete Institute
Give Admin the right to delete an institute registered by a Rep. Add a Delete option in the institute details or institute list, with a confirmation popup before deletion.

### 2. Foot Mapping in Session Target
Add a Foot Mapping option in the Session Target section to record and manage the required foot-mapping information for sessions. Integrate it into the existing target workflow.
> NOTE: exact fields/data NOT yet defined by the client — blocked, do not design or implement.

### 3. Reassign Institute to Another Rep
Allow Admin to reassign an institute from one Rep to another using a representative dropdown. After reassignment, the new Rep should see the institute, and the previous Rep should no longer manage it. Preserve the institute's existing history and visit records.

### 4. Downloadable Field Visit Report
Provide a downloadable report, preferably in Excel format, with these columns: Institution Name, Check-In Date, Check-In Time, Check-Out Time, Location. Allow Admin to download the report for the required date range and review field visits.

### 5. Close Lead — Not Interested
Add a Not Interested option to close a lead. When selected, automatically delete or cancel its upcoming follow-up task so it no longer appears in Pending or the Daily Plan. Preserve the lead and its historical records.

### 6. Password Reset by Email
Add a "Forgot Password?" option on the login page. The user enters their registered email and receives a secure password-reset link. After verification, they can set a new password and log in again.
