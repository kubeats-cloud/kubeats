"use client";

import { useState, useTransition } from "react";
import { StatusOutcomeFields, type StatusOutcomeValue } from "@/components/visits/status-outcome-fields";
import { EMPTY_FEEDBACK } from "@/lib/validation/feedback";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import type { StatusCatalogue } from "@/lib/validation/institute";
import type { StatusField } from "@/lib/status-fields";
import { submitCallReport } from "@/lib/call-report-actions";
import { Button } from "@/components/ui/button";
import { FormNotice } from "@/components/form-notice";

export function LogCallForm({taskId,catalogue,statusFields=[],onSaved}:{taskId:string;catalogue:StatusCatalogue;statusFields?:StatusField[];onSaved:()=>void}) {
  const [value,setValue] = useState<StatusOutcomeValue>({statusSetTo:"",expectedDate:"",followUpDate:"",
    nextAction:{kind:"",due:"",note:""},feedback:EMPTY_FEEDBACK});
  const [state,setState] = useState(EMPTY_STATE);
  const [pending,start] = useTransition();
  return <form onSubmit={event=>{
    event.preventDefault(); const data=new FormData(event.currentTarget);
    start(async()=>{const result=await submitCallReport(data);setState(result);if(result.ok)onSaved();});
  }} className="space-y-4">
    <input type="hidden" name="task_id" value={taskId}/>
    <StatusOutcomeFields catalogue={catalogue} statusFields={statusFields} value={value}
      onChange={patch=>setValue(current=>({...current,...(typeof patch==="function"?patch(current):patch)}))}
      fieldErrors={state.fieldErrors} openLoops={[]} showNextAction />
    {state.error&&<FormNotice message={state.error} fieldErrors={state.fieldErrors}/>}
    <Button type="submit" disabled={pending}>{pending?"Saving…":"Save"}</Button>
  </form>;
}
