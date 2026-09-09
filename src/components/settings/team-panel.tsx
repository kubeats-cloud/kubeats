"use client";

import { useActionState, useState } from "react";
import { CheckCircle2Icon, UserPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createMember } from "@/lib/admin-actions";
import { EMPTY_MEMBER_STATE, type MemberState } from "@/lib/admin-form-state";
import {
  MIN_PASSWORD,
  fieldErrorsFrom,
  newMemberSchema,
} from "@/lib/validation/admin";
import type { TeamMember } from "@/lib/admin";
import { campusLabel, type Campus } from "@/lib/campus-display";

/**
 * The team, and the only way an account gets created.
 *
 * There is no self-signup: an admin makes the account, hands over a temporary
 * password in person, and the rep changes it. The password field is left empty
 * on success and the password is never echoed back — the admin has just typed
 * it, so showing it again adds nothing and puts it on a screen in an office.
 */
export function TeamPanel({
  members,
  campuses,
}: {
  members: TeamMember[];
  /** The five. The demo campus is excluded — nobody is posted to it. */
  campuses: Campus[];
}) {
  const [serverState, formAction, isPending] = useActionState(
    createMember,
    EMPTY_MEMBER_STATE,
  );
  const [clientState, setClientState] = useState<MemberState>(EMPTY_MEMBER_STATE);
  const [role, setRole] = useState("rep");
  // A rep works from one campus; an admin sees every campus and has none. The
  // field clears itself when the role flips to admin so a stale choice cannot
  // be submitted — FO021 would refuse it, and a rejection the form could have
  // prevented is a rejection the form should have prevented.
  const [campusId, setCampusId] = useState("");
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [adding, setAdding] = useState(false);

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = newMemberSchema.safeParse({
      ...values,
      role,
      campus_id: role === "rep" ? campusId : "",
    });
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: "Please check the highlighted fields.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_MEMBER_STATE);
    setValues({ name: "", email: "", password: "" });
  }

  const field = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Team
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Phone: cards. Desktop: a table, because an admin reading this is
            comparing a column of people, not scrolling one. */}
        <ul className="space-y-2 md:hidden">
          {members.map((member) => (
            <li
              key={member.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {member.email ?? "email unavailable"}
                </p>
              </div>
              <Badge
                variant={member.role === "admin" ? "neutral" : "success"}
                className="shrink-0 capitalize"
              >
                {member.role}
              </Badge>
              {member.campusName && (
                <span className="text-muted-foreground truncate text-xs">
                  {member.campusName}
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="border-border hidden overflow-hidden rounded-md border md:block">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Everyone with an account</caption>
            <thead>
              <tr className="border-border bg-secondary/50 text-muted-foreground border-b text-left">
                <th scope="col" className="px-4 py-2 text-xs font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 text-xs font-medium">
                  Email
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium">
                  Role
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.id}
                  className="border-border hover:bg-accent/50 border-b transition-colors last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium">{member.name}</td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {member.email ?? "email unavailable"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge
                      variant={member.role === "admin" ? "neutral" : "success"}
                      className="capitalize"
                    >
                      {member.role}
                    </Badge>
                      {member.campusName && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {member.campusName}
                        </span>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {serverState.created && (
          <div
            role="status"
            className="bg-success-subtle text-success-subtle-foreground space-y-1 rounded-md px-3 py-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2Icon className="size-4" aria-hidden />
              {serverState.created.name} can sign in now
            </p>
            <p>
              Give them {serverState.created.email} and the password you just
              typed, and ask them to change it. The password is not shown again.
            </p>
          </div>
        )}

        {!adding ? (
          <Button
            type="button"
            className="h-11 w-full"
            onClick={() => setAdding(true)}
          >
            <UserPlusIcon className="size-4" aria-hidden />
            Add a team member
          </Button>
        ) : (
          <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
            <input type="hidden" name="role" value={role} />

            <div className="space-y-2">
              <Label htmlFor="member-name">Name</Label>
              <Input
                id="member-name"
                name="name"
                className="h-11"
                maxLength={120}
                autoComplete="off"
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                aria-invalid={fieldErrors.name ? true : undefined}
              />
              {field("name")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                name="email"
                type="email"
                inputMode="email"
                className="h-11"
                autoComplete="off"
                value={values.email}
                onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                aria-invalid={fieldErrors.email ? true : undefined}
              />
              {field("email")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-password">Temporary password</Label>
              <Input
                id="member-password"
                name="password"
                type="password"
                className="h-11"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) =>
                  setValues((v) => ({ ...v, password: e.target.value }))
                }
                aria-invalid={fieldErrors.password ? true : undefined}
              />
              <p className="text-muted-foreground text-xs">
                At least {MIN_PASSWORD} characters. Hand it over in person and
                ask them to change it.
              </p>
              {field("password")}
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rep">Rep (logs their own visits)</SelectItem>
                  <SelectItem value="admin">
                    Admin (sees the team and these settings)
                  </SelectItem>
                </SelectContent>
              </Select>
              {field("role")}
            </div>

            {/* Shown only for a rep. An admin is not posted to a campus, so
                offering them one would be offering a choice with no meaning. */}
            {role === "rep" && (
              <div className="space-y-2">
                <Label>Campus</Label>
                <Select value={campusId} onValueChange={setCampusId}>
                  <SelectTrigger className="h-11 w-full" aria-label="Campus">
                    <SelectValue placeholder="Which campus do they work from?" />
                  </SelectTrigger>
                  <SelectContent>
                    {campuses.map((campus) => (
                      <SelectItem key={campus.id} value={campus.id}>
                        {campusLabel(campus)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="campus_id" value={campusId} />
                <p className="text-muted-foreground text-xs">
                  They will see only this campus&rsquo;s institutes, visits and
                  materials. It cannot be changed from here afterwards.
                </p>
                {field("campus_id")}
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
              >
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" className="h-11 flex-1" disabled={isPending}>
                {isPending ? "Creating…" : "Create account"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => {
                  setAdding(false);
                  setValues({ name: "", email: "", password: "" });
                  setClientState(EMPTY_MEMBER_STATE);
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
