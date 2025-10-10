import EvaluationLibrary from "./opena11y-evaluation-library";  
window.openA11y = {
    evaluate : function (ruleset="WCAG21", level="AA", ruleList=[]) {
        console.log('evaluating')
        const doc = window.document;
        const evaluationLibrary = new EvaluationLibrary;
        let evaluationResult;
        switch (ruleset) {

            case 'WCAG20':
            case 'WCAG21':
            case 'WCAG22':
                evaluationResult = evaluationLibrary.evaluateWCAG(doc, doc.title, doc.location.href, ruleset, level, scopeFilter);
                break;

            case 'LIST':
                evaluationResult = evaluationLibrary.evaluateRuleList(doc, doc.title, doc.location.href, ruleList);
                break;

            case 'FIRSTSTEP':
                evaluationResult = evaluationLibrary.evaluateFirstStepRules(doc, doc.title, doc.location.href);
                break;

            default:
                break;

            }

            return evaluationResult;

    }
}
