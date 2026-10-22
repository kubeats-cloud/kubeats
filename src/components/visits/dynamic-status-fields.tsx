"use client";

import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/required-mark";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { StatusField } from "@/lib/status-fields";

export function DynamicStatusFields({
  status,
  fields,
  values,
  onChange,
  fieldErrors,
}: {
  status: string | null;
  fields: StatusField[];
  values: Record<string, string>;
  onChange: (fieldName: string, value: string) => void;
  fieldErrors: Record<string, string>;
}) {
  if (!status) return null;
  const applicableFields = fields.filter((f) => f.status === status);
  if (applicableFields.length === 0) return null;

  return (
    <div className="space-y-4 pt-2">
      <input type="hidden" name="custom_fields_payload" value={JSON.stringify(values)} />
      {applicableFields.map((field) => {
        const error = fieldErrors[`custom_${field.fieldName}`] || fieldErrors[field.fieldName];
        return (
          <div key={field.id} className="space-y-2 sm:max-w-md">
            <Label htmlFor={`custom-field-${field.id}`}>
              {field.fieldName} {field.isRequired && <RequiredMark />}
            </Label>
            {field.fieldType === "select" ? (
              <Select
                value={values[field.fieldName] ?? ""}
                onValueChange={(val) => onChange(field.fieldName, val)}
              >
                <SelectTrigger
                  id={`custom-field-${field.id}`}
                  className="h-11 w-full"
                  aria-label={field.fieldName}
                  aria-invalid={error ? true : undefined}
                >
                  <SelectValue placeholder={`Select ${field.fieldName}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.fieldType === "date" ? (
              <Input
                id={`custom-field-${field.id}`}
                type="date"
                className="h-11"
                value={values[field.fieldName] ?? ""}
                onChange={(e) => onChange(field.fieldName, e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            ) : (
              <Input
                id={`custom-field-${field.id}`}
                type="text"
                className="h-11"
                value={values[field.fieldName] ?? ""}
                onChange={(e) => onChange(field.fieldName, e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            )}
            {error && <p className="text-danger text-xs">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
