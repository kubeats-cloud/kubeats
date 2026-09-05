import { describe, expect, it } from "vitest";
import {
  closingReportSchema,
  closingReportFormDataToInput,
} from "@/lib/validation/closing-report";

const base = (over: Record<string, unknown> = {}) => ({
  visit_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  people: [{ name: "A", contact_type: "Principal", designation: "", contact_number: "", is_decision_maker: false }],
  activities_conducted: ["Introduction meeting"],
  session_topic: "", session_class: "", session_streams: [],
  students_attended: "", session_duration_mins: "", other_faculty_present: "",
  other_faculty_count: "", session_participation: "", student_questions: "",
  students_reached: "",
  student_response: "", student_interest: "",
  most_interested_programs: [], student_intent: "",
  management_response: [], management_feedback: "", management_interest: "",
  discussion_summary: "Talked about the programme.",
  visit_outcome: "Successful",
  primary_outcome: "Meeting completed",
  applications_collected: "", admissions_generated: "",
  follow_up_needed: false, follow_up_action: "", follow_up_date: "",
  employee_remarks: "",
  ...over,
});
const errs = (r: { success: boolean; error?: { issues: { path: unknown[]; message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("closing report enrichment", () => {
  it("accepts a valid report with the new fields", () => {
    const r = closingReportSchema.safeParse(base({
      students_reached: "120", most_interested_programs: ["Engineering", "AI/ML"],
      student_intent: "Strongly Interested",
    }));
    expect(r.success).toBe(true);
  });
  it("requires primary_outcome always", () => {
    expect(errs(closingReportSchema.safeParse(base({ primary_outcome: "" })))).toContain("primary_outcome");
  });
  it("requires management_interest when a management meeting happened", () => {
    const e = errs(closingReportSchema.safeParse(base({
      activities_conducted: ["Management meeting"],
      management_response: ["Supportive"], management_feedback: "ok", management_interest: "",
    })));
    expect(e).toContain("management_interest");
  });
  it("accepts management_interest when supplied", () => {
    const r = closingReportSchema.safeParse(base({
      activities_conducted: ["Management meeting"],
      management_response: ["Supportive"], management_feedback: "ok", management_interest: "Very High",
    }));
    expect(r.success).toBe(true);
  });
  it("accepts the widened participation scale (Very High) for a session", () => {
    const r = closingReportSchema.safeParse(base({
      activities_conducted: ["Career guidance session"],
      session_topic: "X", session_class: "12", students_attended: "40",
      session_participation: "Very High",
    }));
    expect(r.success).toBe(true);
  });
  it("accepts Faculty Interaction as an activity", () => {
    expect(closingReportSchema.safeParse(base({ activities_conducted: ["Faculty Interaction"] })).success).toBe(true);
  });
  it("rejects an out-of-list program or intent or interest or outcome", () => {
    expect(errs(closingReportSchema.safeParse(base({ most_interested_programs: ["Astrology"] })))).toContain("most_interested_programs");
    expect(errs(closingReportSchema.safeParse(base({ student_intent: "Maybe" })))).toContain("student_intent");
    expect(errs(closingReportSchema.safeParse(base({ activities_conducted: ["Management meeting"], management_response: ["Supportive"], management_feedback: "ok", management_interest: "Enormous" })))).toContain("management_interest");
    expect(errs(closingReportSchema.safeParse(base({ primary_outcome: "World peace" })))).toContain("primary_outcome");
  });
  it("form-data mapping carries the new keys", () => {
    const fd = new FormData();
    fd.set("visit_id", "x"); fd.set("students_reached", "10");
    fd.append("most_interested_programs", "Design"); fd.set("student_intent", "Interested");
    fd.set("management_interest", "High"); fd.set("primary_outcome", "Other");
    const out = closingReportFormDataToInput(fd) as Record<string, unknown>;
    expect(out.students_reached).toBe("10");
    expect(out.most_interested_programs).toEqual(["Design"]);
    expect(out.student_intent).toBe("Interested");
    expect(out.management_interest).toBe("High");
    expect(out.primary_outcome).toBe("Other");
  });
});
