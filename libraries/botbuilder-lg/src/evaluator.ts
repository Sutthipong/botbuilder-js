/**
 * @module botbuilder-lg
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { AbstractParseTreeVisitor, TerminalNode } from 'antlr4ts/tree';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { ExpressionFunctions, Constant, EvaluatorLookup, Expression, ExpressionParser, ExpressionEvaluator, ExpressionType, ReturnType, SimpleObjectMemory, Options} from 'adaptive-expressions';
import { keyBy } from 'lodash';
import { CustomizedMemory } from './customizedMemory';
import { EvaluationTarget } from './evaluationTarget';
import * as lp from './generated/LGTemplateParser';
import { LGTemplateParserVisitor } from './generated/LGTemplateParserVisitor';
import { Template } from './template';
import * as path from 'path';
import * as fs from 'fs';
import { TemplateExtensions } from './templateExtensions';
import { TemplateErrors } from './templateErrors';
import { EvaluationOptions, LGLineBreakStyle } from './evaluationOptions';
/**
 * Evaluation runtime engine
 */
export class Evaluator extends AbstractParseTreeVisitor<any> implements LGTemplateParserVisitor<any> {

    /**
     * Templates.
     */
    public readonly templates: Template[];

    /**
     * Expression parser.
     */
    public readonly expressionParser: ExpressionParser;

    /**
     * TemplateMap.
     */
    public readonly templateMap: { [name: string]: Template };
    private readonly evaluationTargetStack: EvaluationTarget[] = [];
    private readonly lgOptions: EvaluationOptions;

    // to support broswer, use look-ahead replace look-behind
    // PCRE: (?<!\\)\${(('(\\('|\\)|[^'])*?')|("(\\("|\\)|[^"])*?")|(`(\\(`|\\)|[^`])*?`)|([^\r\n{}'"`])|({\s*}))+}?
    public static readonly expressionRecognizeReverseRegex: RegExp = new RegExp(/\}?(('((('|\\)\\)|[^'])*?')|("(\\("|\\)|[^"])*?")|(`(\\(`|\\)|[^`])*?`)|([^\r\n{}'"`])|({\s*}))+{\$(?!\\)/gm);
    public readonly newLineRegex = /(\r?\n)/g;
    public static readonly LGType = 'lgType';
    public static readonly activityAttachmentFunctionName = 'ActivityAttachment';
    public static readonly fromFileFunctionName = 'fromFile';
    public static readonly templateFunctionName = 'template';
    public static readonly isTemplateFunctionName = 'isTemplate';
    public static readonly ReExecuteSuffix = '!';

    public constructor(templates: Template[], expressionParser: ExpressionParser, opt: EvaluationOptions = undefined) {
        super();
        this.templates = templates;
        this.templateMap = keyBy(templates, (t: Template): string => t.name);
        this.lgOptions = opt;

        // generate a new customzied expression parser by injecting the templates as functions
        this.expressionParser = new ExpressionParser(this.customizedEvaluatorLookup(expressionParser.EvaluatorLookup));
    }

    public static wrappedRegExSplit(inputString: string, regex: RegExp): string[] {
        return inputString.split('').reverse().join('').split(regex).map((e: string): string => e.split('').reverse().join('')).reverse();
    }

    /**
     * Evaluate a template with given name and scope.
     * @param inputTemplateName Template name.
     * @param scope Scope.
     * @returns Evaluate result.
     */
    public evaluateTemplate(inputTemplateName: string, scope: any): any {
        let templateName: string;
        let reExecute: boolean;
        ({reExecute, pureTemplateName: templateName} = this.parseTemplateName(inputTemplateName));

        if (!(templateName in this.templateMap)) {
            throw new Error(TemplateErrors.templateNotExist(templateName));
        }

        if (this.evaluationTargetStack.some((u: EvaluationTarget): boolean => u.templateName === templateName)) {
            throw new Error(`${ TemplateErrors.loopDetected } ${ this.evaluationTargetStack.reverse()
                .map((u: EvaluationTarget): string => u.templateName)
                .join(' => ') }`);
        }

        if (!(scope instanceof CustomizedMemory)) {
            scope = new CustomizedMemory(SimpleObjectMemory.wrap(scope));
        }

        const templateTarget: EvaluationTarget = new EvaluationTarget(templateName, scope);
        const currentEvulateId: string = templateTarget.getId();

        let previousEvaluateTarget: EvaluationTarget;

        if (this.evaluationTargetStack.length !== 0) {
            previousEvaluateTarget = this.evaluationTargetStack[this.evaluationTargetStack.length - 1];
            if (!reExecute && previousEvaluateTarget.evaluatedChildren.has(currentEvulateId)) {
                return previousEvaluateTarget.evaluatedChildren.get(currentEvulateId);
            }
        }

        // Using a stack to track the evalution trace
        this.evaluationTargetStack.push(templateTarget);
        let result: string = this.visit(this.templateMap[templateName].templateBodyParseTree);

        if (previousEvaluateTarget) {
            previousEvaluateTarget.evaluatedChildren.set(currentEvulateId, result);
        }

        this.evaluationTargetStack.pop();

        if (this.lgOptions.LineBreakStyle === LGLineBreakStyle.Markdown && typeof result === 'string') {
            result = result.replace(this.newLineRegex, '$1$1');
        }

        return result;
    }

    public visitStructuredTemplateBody(ctx: lp.StructuredTemplateBodyContext): any {
        const result: any = {};
        const typeName: string = ctx.structuredBodyNameLine().STRUCTURE_NAME().text;
        result[Evaluator.LGType] = typeName;

        const bodys = ctx.structuredBodyContentLine();
        for (const body of bodys) {
            const isKVPairBody = body.keyValueStructureLine() !== undefined;
            if (isKVPairBody) {
                const property = body.keyValueStructureLine().STRUCTURE_IDENTIFIER().text.toLowerCase();
                const value = this.visitStructureValue(body.keyValueStructureLine());
                result[property] = value;
            } else {
                const propertyObject: any = this.evalExpression(body.objectStructureLine().text, body.objectStructureLine());
                // Full reference to another structured template is limited to the structured template with same type
                if (typeof propertyObject === 'object' && Evaluator.LGType in propertyObject &&  propertyObject[Evaluator.LGType].toString() === typeName) {
                    for (const key of Object.keys(propertyObject)) {
                        if (propertyObject.hasOwnProperty(key) && !(key in result)) {
                            result[key] = propertyObject[key];
                        }
                    }
                }
            }
        }

        return result;
    }

    private visitStructureValue(ctx: lp.KeyValueStructureLineContext): any {
        const values = ctx.keyValueStructureValue();

        const result = [];
        for(const item of values) {
            if (TemplateExtensions.isPureExpression(item).hasExpr) {
                result.push(this.evalExpression(TemplateExtensions.isPureExpression(item).expression, ctx));
            } else {
                let itemStringResult = '';
                for(const node of item.children) {
                    switch ((node as TerminalNode).symbol.type) {
                        case (lp.LGTemplateParser.ESCAPE_CHARACTER_IN_STRUCTURE_BODY): 
                            itemStringResult += TemplateExtensions.evalEscape(node.text.replace(/\\\|/g, '|'));
                            break;
                        
                        case (lp.LGTemplateParser.EXPRESSION_IN_STRUCTURE_BODY):
                            const errorPrefix = `Property '` + ctx.STRUCTURE_IDENTIFIER().text + `':`;
                            itemStringResult += this.evalExpression(node.text, ctx, errorPrefix);
                            break;
                        
                        default:
                            itemStringResult += node.text;
                            break;
                    }
                }

                result.push(itemStringResult.trim());
            }
        }

        return result.length === 1? result[0] : result;
    }

    public visitNormalBody(ctx: lp.NormalBodyContext): any {
        return this.visit(ctx.normalTemplateBody());
    }

    public visitNormalTemplateBody(ctx: lp.NormalTemplateBodyContext): any {
        const normalTemplateStrs: lp.TemplateStringContext[] = ctx.templateString();
        const randomNumber: number = Math.floor(Math.random() * normalTemplateStrs.length);

        return this.visit(normalTemplateStrs[randomNumber].normalTemplateString());
    }

    public visitIfElseBody(ctx: lp.IfElseBodyContext): any {
        const ifRules: lp.IfConditionRuleContext[] = ctx.ifElseTemplateBody().ifConditionRule();
        for (const ifRule of ifRules) {
            if (this.evalCondition(ifRule.ifCondition()) && ifRule.normalTemplateBody() !== undefined) {
                return this.visit(ifRule.normalTemplateBody());
            }
        }

        return undefined;
    }

    public visitNormalTemplateString(ctx: lp.NormalTemplateStringContext): string {
        const prefixErrorMsg = TemplateExtensions.getPrefixErrorMessage(ctx);
        const result: any[] = [];
        for (const node of ctx.children) {
            const innerNode: TerminalNode = node as TerminalNode;
            switch (innerNode.symbol.type) {
                case lp.LGTemplateParser.MULTILINE_SUFFIX:
                case lp.LGTemplateParser.MULTILINE_PREFIX:
                case lp.LGTemplateParser.DASH:
                    break;
                case lp.LGTemplateParser.ESCAPE_CHARACTER:
                    result.push(TemplateExtensions.evalEscape(innerNode.text));
                    break;
                case lp.LGTemplateParser.EXPRESSION:
                    result.push(this.evalExpression(innerNode.text, ctx, prefixErrorMsg));
                    break;
                default: {
                    result.push(innerNode.text);
                    break;
                }
            }
        }

        if (result.length === 1 && !(typeof result[0] === 'string')) {
            return result[0];
        }

        return result.map((u: any): string => {
            if (typeof u === 'string') {
                return u;
            } else {
                return JSON.stringify(u);
            }
        }).join('');
    }

    public constructScope(inputTemplateName: string, args: any[]): any {
        var templateName = this.parseTemplateName(inputTemplateName).pureTemplateName;

        if (!(templateName in this.templateMap)) {
            throw new Error(TemplateErrors.templateNotExist(templateName));
        }

        const parameters: string[] = this.templateMap[templateName].parameters;
        const currentScope: any = this.currentTarget().scope;

        if (args.length === 0) {
            // no args to construct, inherit from current scope
            return currentScope;
        }

        const newScope: any = {};
        parameters.map((e: string, i: number): void => newScope[e] = args[i]);
        const memory = currentScope as CustomizedMemory;
        if (!memory) {
            throw new Error(TemplateErrors.invalidMemory);
        }

        return new CustomizedMemory(memory.globalMemory, SimpleObjectMemory.wrap(newScope));
    }

    public visitSwitchCaseBody(ctx: lp.SwitchCaseBodyContext): string {
        const switchcaseNodes: lp.SwitchCaseRuleContext[] = ctx.switchCaseTemplateBody().switchCaseRule();
        const length: number = switchcaseNodes.length;
        const switchNode: lp.SwitchCaseRuleContext = switchcaseNodes[0];
        const switchExprs: TerminalNode[] = switchNode.switchCaseStat().EXPRESSION();
        const switchErrorPrefix = `Switch '` + switchExprs[0].text + `': `;
        const switchExprResult = this.evalExpression(switchExprs[0].text, switchcaseNodes[0].switchCaseStat(), switchErrorPrefix).toString();
        let idx = 0;
        for (const caseNode of switchcaseNodes) {
            if (idx === 0) {
                idx++;
                continue; //skip the first node which is a switch statement
            }
            if (idx === length - 1 && caseNode.switchCaseStat().DEFAULT() !== undefined) {
                const defaultBody: lp.NormalTemplateBodyContext = caseNode.normalTemplateBody();
                if (defaultBody !== undefined) {
                    return this.visit(defaultBody);
                } else {
                    return undefined;
                }
            }

            const caseExprs: TerminalNode[] = caseNode.switchCaseStat().EXPRESSION();
            const caseErrorPrefix = `Case '` + caseExprs[0].text + `': `;
            const caseExprResult = this.evalExpression(caseExprs[0].text, caseNode.switchCaseStat(), caseErrorPrefix).toString();
            if (switchExprResult === caseExprResult) {
                return this.visit(caseNode.normalTemplateBody());
            }

            idx++;
        }

        return undefined;
    }

    public wrappedEvalTextContainsExpression(exp: string, regex: RegExp): string {
        return (exp.split('').reverse().join('').replace(regex, (sub: string): any => this.evalExpression(sub.split('').reverse().join('')).toString().split('').reverse().join(''))).split('').reverse().join('');
    }

    protected defaultResult(): string {
        return '';
    }

    public static concatErrorMsg(firstError: string, secondError: string): string {
        let errorMsg: string;
        if (!firstError) {
            errorMsg = secondError;
        } else if (!secondError){
            errorMsg = firstError;
        } else {
            errorMsg = firstError + ' ' + secondError;
        }
        return errorMsg;
    }

    public static checkExpressionResult(exp: string, error: string, result: any, templateName: string, context?: ParserRuleContext, errorPrefix: string = ''): void {
        let errorMsg = '';

        let childErrorMsg = '';
        if (error)
        {
            childErrorMsg = Evaluator.concatErrorMsg(childErrorMsg, error);
        }
        else if (!result)
        {
            childErrorMsg = Evaluator.concatErrorMsg(childErrorMsg, TemplateErrors.nullExpression(exp));
        }

        if (context)
        {
            errorMsg = Evaluator.concatErrorMsg(errorMsg, TemplateErrors.errorExpression(context.text, templateName, errorPrefix));
        }

        throw new Error(Evaluator.concatErrorMsg(childErrorMsg, errorMsg));
    }

    private currentTarget(): EvaluationTarget {
        // just don't want to write evaluationTargetStack.Peek() everywhere
        return this.evaluationTargetStack[this.evaluationTargetStack.length - 1];
    }

    private evalCondition(condition: lp.IfConditionContext): boolean {
        const expression: TerminalNode = condition.EXPRESSION()[0]; // Here ts is diff with C#, C# use condition.EXPRESSION(0) == null
        // to judge ELSE condition. But in ts lib this action would throw
        // Error

        if (!expression) {
            return true;                                            // no expression means it's else
        }

        if (this.evalExpressionInCondition(expression.text, condition, `Condition '` + expression.text + `':`)) {
            return true;
        }

        return false;
    }

    private evalExpressionInCondition(exp: string, context?: ParserRuleContext, errorPrefix: string = ''): boolean {
        exp = TemplateExtensions.trimExpression(exp);
        let result: any;
        let error: string;
        ({value: result, error: error} = this.evalByAdaptiveExpression(exp, this.currentTarget().scope));

        if (this.lgOptions.strictMode && (error || !result))
        {
            const templateName = this.currentTarget().templateName;

            if (this.evaluationTargetStack.length > 0)
            {
                this.evaluationTargetStack.pop();
            }

            Evaluator.checkExpressionResult(exp, error, result, templateName, context, errorPrefix);
        } else if (error || !result)
        {
            return false;
        }

        return true;
    }

    private evalExpression(exp: string, context?: ParserRuleContext, errorPrefix: string = ''): any
    {
        exp = TemplateExtensions.trimExpression(exp);
        let result: any;
        let error: string;
        ({value: result, error: error} = this.evalByAdaptiveExpression(exp, this.currentTarget().scope));

        if (error || (result === undefined && this.lgOptions.strictMode))
        {
            const templateName = this.currentTarget().templateName;

            if (this.evaluationTargetStack.length > 0)
            {
                this.evaluationTargetStack.pop();
            }

            Evaluator.checkExpressionResult(exp, error, result, templateName, context, errorPrefix);
        }
        else if (result === undefined && !this.lgOptions.strictMode)
        {
            result = `null`;
        }

        return result;
    }

    private evalByAdaptiveExpression(exp: string, scope: any): { value: any; error: string } {
        const parse: Expression = this.expressionParser.parse(exp);
        const opt = new Options();
        opt.nullSubstitution = this.lgOptions.nullSubstitution;

        return parse.tryEvaluate(scope, opt);
    }

    // Genearte a new lookup function based on one lookup function
    private readonly customizedEvaluatorLookup = (baseLookup: EvaluatorLookup): any => (name: string): any => {
        const standardFunction = baseLookup(name);

        if (standardFunction !== undefined) {
            return standardFunction;
        }
        
        if (name.startsWith('lg.')) {
            name = name.substring(3);
        }

        var templateName = this.parseTemplateName(name).pureTemplateName;
        if (templateName in this.templateMap) {
            return new ExpressionEvaluator(templateName, ExpressionFunctions.apply(this.templateEvaluator(name)), ReturnType.Object, this.validTemplateReference);
        }

        if (name === Evaluator.templateFunctionName) {
            return new ExpressionEvaluator(Evaluator.templateFunctionName, ExpressionFunctions.apply(this.templateFunction()), ReturnType.Object, this.validateTemplateFunction);
        }

        if (name === Evaluator.fromFileFunctionName) {
            return new ExpressionEvaluator(Evaluator.fromFileFunctionName, ExpressionFunctions.apply(this.fromFile()), ReturnType.Object, ExpressionFunctions.validateUnaryString);
        }

        if (name === Evaluator.activityAttachmentFunctionName) {
            return new ExpressionEvaluator(
                Evaluator.activityAttachmentFunctionName, 
                ExpressionFunctions.apply(this.activityAttachment()), 
                ReturnType.Object, 
                (expr): void => ExpressionFunctions.validateOrder(expr, undefined, ReturnType.Object, ReturnType.String));
        }

        if (name === Evaluator.isTemplateFunctionName) {
            return new ExpressionEvaluator(Evaluator.isTemplateFunctionName, ExpressionFunctions.apply(this.isTemplate()), ReturnType.Boolean, ExpressionFunctions.validateUnaryString);
        }

        return undefined;
    }

    private readonly isTemplate = (): any => (args: readonly any[]): boolean => {
        const templateName = args[0].toString();
        return templateName in this.templateMap;
    }

    private readonly fromFile = (): any => (args: readonly any[]): any => {
        const filePath: string = TemplateExtensions.normalizePath(args[0].toString());
        const resourcePath: string = this.getResourcePath(filePath);
        const stringContent = fs.readFileSync(resourcePath, 'utf-8');

        const result = this.wrappedEvalTextContainsExpression(stringContent, Evaluator.expressionRecognizeReverseRegex);
        return TemplateExtensions.evalEscape(result);
    }

    private getResourcePath(filePath: string): string {
        let resourcePath: string;
        if (path.isAbsolute(filePath)) {
            resourcePath = filePath;
        } else {
            // relative path is not support in broswer environment
            const inBrowser: boolean = typeof window !== 'undefined';
            if (inBrowser) {
                throw new Error('relative path is not support in browser.');
            }
            const template: Template = this.templateMap[this.currentTarget().templateName];
            const sourcePath: string = TemplateExtensions.normalizePath(template.sourceRange.source);
            let baseFolder: string = __dirname;
            if (path.isAbsolute(sourcePath)) {
                baseFolder = path.dirname(sourcePath);
            }

            resourcePath = path.join(baseFolder, filePath);
        }

        return resourcePath;
    }

    private readonly activityAttachment = (): any => (args: readonly any[]): any => {
        return {
            [Evaluator.LGType]: 'attachment',
            contenttype: args[1].toString(),
            content: args[0]
        };
    }

    private readonly templateFunction = (): any => (args: readonly any[]): any => {
        const templateName: string = args[0];
        const newScope: any = this.constructScope(templateName, args.slice(1));

        return this.evaluateTemplate(templateName, newScope);
    }

    private readonly validateTemplateFunction = (expression: Expression): void => {
        
        ExpressionFunctions.validateAtLeastOne(expression);

        const children0: Expression = expression.children[0];

        // Validate return type
        if ((children0.returnType & ReturnType.Object) === 0 && (children0.returnType & ReturnType.String) === 0) {
            throw new Error(TemplateErrors.invalidTemplateName);
        }

        // Validate more if the name is string constant
        if (children0.type === ExpressionType.Constant) {
            const templateName: string = (children0 as Constant).value;
            this.checkTemplateReference(templateName, expression.children.slice(1));
        }
    }

    private checkTemplateReference(templateName: string, children: Expression[]): void{
        if (!(templateName in this.templateMap))
        {
            throw new Error(TemplateErrors.templateNotExist(templateName));
        }

        var expectedArgsCount = this.templateMap[templateName].parameters.length;
        var actualArgsCount = children.length;

        if (actualArgsCount !== 0 && expectedArgsCount !== actualArgsCount)
        {
            throw new Error(TemplateErrors.argumentMismatch(templateName, expectedArgsCount, actualArgsCount));
        }
    }

    private readonly templateEvaluator = (templateName: string): any => (args: readonly any[]): any => {
        const newScope: any = this.constructScope(templateName, Array.from(args));

        return this.evaluateTemplate(templateName, newScope);
    }

    private readonly validTemplateReference = (expression: Expression): void => {
        return this.checkTemplateReference(expression.type, expression.children);
    }

    private parseTemplateName(templateName: string): { reExecute: boolean; pureTemplateName: string } {
        if (!templateName) {
            throw new Error('template name is empty.');
        }

        if (templateName.endsWith(Evaluator.ReExecuteSuffix)) {
            return {reExecute:true, pureTemplateName: templateName.substr(0, templateName.length - Evaluator.ReExecuteSuffix.length)};
        } else {
            return {reExecute:false, pureTemplateName: templateName};
        }
    }
}
