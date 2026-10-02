/**
 * @name Missing origin verification in `postMessage` handler
 * @description Missing origin verification in a `postMessage` handler allows any windows to send arbitrary data to the handler.
 * @kind problem
 * @problem.severity warning
 * @security-severity 5
 * @precision medium
 * @id js/missing-origin-check
 * @tags correctness
 *       security
 *       external/cwe/cwe-020
 *       external/cwe/cwe-940
 */

import javascript

/** A function that handles "message" events. */
class PostMessageHandler extends DataFlow::FunctionNode {
  override PostMessageEventHandler astNode;

  /** Gets the parameter that contains the event. */
  DataFlow::ParameterNode getEventParameter() {
    result = DataFlow::parameterNode(astNode.getEventParameter())
  }
}

/** Gets a reference to the event from a postmessage `handler` */
DataFlow::SourceNode event(DataFlow::TypeTracker t, PostMessageHandler handler) {
  t.start() and
  result = handler.getEventParameter()
  or
  exists(DataFlow::TypeTracker t2 | result = event(t2, handler).track(t2, t))
}

/** Gets a reference to the .origin from a postmessage event. */
DataFlow::SourceNode origin(DataFlow::TypeTracker t, PostMessageHandler handler) {
  t.start() and
  result = event(DataFlow::TypeTracker::end(), handler).getAPropertyRead("origin")
  or
  result =
    origin(t.continue(), handler)
        .getAMethodCall([
            "toString", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase"
          ])
  or
  exists(DataFlow::TypeTracker t2 | result = origin(t2, handler).track(t2, t))
}

/** Gets a reference to the .source from a postmessage event. */
DataFlow::SourceNode source(DataFlow::TypeTracker t, PostMessageHandler handler) {
  t.start() and
  result = event(DataFlow::TypeTracker::end(), handler).getAPropertyRead("source")
  or
  exists(DataFlow::TypeTracker t2 | result = source(t2, handler).track(t2, t))
}

/** Gets a reference to the origin or the source of a postmessage event. */
DataFlow::SourceNode sourceOrOrigin(PostMessageHandler handler) {
  result = source(DataFlow::TypeTracker::end(), handler) or
  result = origin(DataFlow::TypeTracker::end(), handler)
}

/** Holds if there exists a check of the .origin or .source of the postmessage `handler`. */
predicate hasOriginCheck(PostMessageHandler handler) {
  // event.origin === "constant"
  exists(EqualityTest test | sourceOrOrigin(handler).flowsToExpr(test.getAnOperand()))
  or
  // set.includes(event.source)
  exists(InclusionTest test | sourceOrOrigin(handler).flowsTo(test.getContainedNode()))
  or
  // "safeOrigin".startsWith(event.origin)
  exists(StringOps::StartsWith starts |
    origin(DataFlow::TypeTracker::end(), handler).flowsTo(starts.getSubstring())
  )
  or
  // "safeOrigin".endsWith(event.origin)
  exists(StringOps::EndsWith ends |
    origin(DataFlow::TypeTracker::end(), handler).flowsTo(ends.getSubstring())
  )
}

/** Only a direct inline registration in the positively guarded worker branch.
 * No filename, import-path, or unrelated/late guard exempts a handler.
 */
predicate hasWorkerGlobalReassignment() {
  exists(GlobalVarAccess access |
    access.getName() = ["DedicatedWorkerGlobalScope", "self"] and
    exists(access.getVariable().getAnAssignedExpr())
  )
  or
  exists(DataFlow::globalObjectRef().getAPropertyWrite(["DedicatedWorkerGlobalScope", "self"]))
  or
  // Conservatively include aliases, even when global-variable flow is unavailable.
  exists(Assignment assignment, PropAccess property |
    assignment.getLhs() = property and
    property.getPropertyName() = ["DedicatedWorkerGlobalScope", "self"]
  )
  or
  // Do not bless explicit reflective replacement of either worker global.
  exists(MethodCallExpr call |
    call.getMethodName() = ["set", "defineProperty"] and
    exists(call.getArgument(2)) and
    call.getArgument(1).(StringLiteral).getValue() = ["DedicatedWorkerGlobalScope", "self"]
  )
}

predicate isGuardedDedicatedWorkerHandler(PostMessageHandler handler) {
  not hasWorkerGlobalReassignment() and
  exists(AssignExpr assignment, IfStmt guard, BlockStmt body,
      LogAndExpr conjunction, StrictEqExpr typeCheck, TypeofExpr typeOf,
      InstanceofExpr workerCheck |
    assignment.getRhs() = handler.asExpr() and
    assignment = DataFlow::globalObjectRef().getAPropertyWrite("onmessage").getWriteNode() and
    assignment.getParent() = body.getStmt(0) and
    guard.getThen() = body and
    guard.getCondition() = conjunction and
    conjunction.getLeftOperand() = typeCheck and
    typeCheck.getLeftOperand() = typeOf and
    typeCheck.getRightOperand().(StringLiteral).getValue() = "function" and
    typeOf.getOperand() = DataFlow::globalVarRef("DedicatedWorkerGlobalScope").asExpr() and
    conjunction.getRightOperand() = workerCheck and
    workerCheck.getLeftOperand() = DataFlow::globalVarRef("self").asExpr() and
    workerCheck.getRightOperand() = DataFlow::globalVarRef("DedicatedWorkerGlobalScope").asExpr()
  )
}

from PostMessageHandler handler
where not hasOriginCheck(handler) and not isGuardedDedicatedWorkerHandler(handler)
select handler.getEventParameter(), "Postmessage handler has no origin check."
