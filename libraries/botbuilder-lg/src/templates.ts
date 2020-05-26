/**
 * @module botbuilder-lg
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Template } from './template';
import { TemplateImport } from './templateImport';
import { Diagnostic, DiagnosticSeverity } from './diagnostic';
import { ExpressionParser, Expression, ExpressionEvaluator, ExpressionFunctions, ReturnType } from 'adaptive-expressions';
import { ImportResolverDelegate } from './templatesParser';
import { Evaluator } from './evaluator';
import { Expander } from './expander';
import { Analyzer } from './analyzer';
import { TemplatesParser } from './templatesParser';
import { AnalyzerResult } from './analyzerResult';
import { TemplateErrors } from './templateErrors';
import { TemplateExtensions } from './templateExtensions';
import { EvaluationOptions, LGLineBreakStyle } from './evaluationOptions';
import { isAbsolute, basename } from 'path';

/**
 * LG entrance, including properties that LG file has, and evaluate functions.
 */
export class Templates implements Iterable<Template> {
    private readonly newLineRegex = /(\r?\n)/g;
    private readonly newLine: string = '\r\n';
    private readonly namespaceKey = '@namespace';
    private readonly exportsKey = '@exports';
    private items: Template[];

    /**
     * import elements that this LG file contains directly.
     */
    public imports: TemplateImport[];

    /**
     * diagnostics.
     */
    public diagnostics: Diagnostic[];

    /**
     * all references that this LG file has from Imports
     * otice: reference includs all child imports from the lg file,
     * not only the children belong to this lgfile directly.
     * so, reference count may >= imports count.
     */
    public references: Templates[];

    /**
     * LG content.
     */
    public content: string;

    /**
     * id of this lg source. For file, is full path.
     */
    public id: string;

    /**
     * expression parser.
     */
    public expressionParser: ExpressionParser;

    /**
     * Delegate for resolving resource id of imported lg file.
     */
    public importResolver: ImportResolverDelegate;

    /**
     * LG file options.
     */
    public options: string[];

    public constructor(items?: Template[],
        imports?: TemplateImport[],
        diagnostics?: Diagnostic[],
        references?: Templates[],
        content?: string,
        id?: string,
        expressionParser?: ExpressionParser,
        importResolverDelegate?: ImportResolverDelegate,
        options?: string[]) {
        this.items = items || [];
        this.imports = imports || [];
        this.diagnostics = diagnostics || [];
        this.references = references || [];
        this.content = content || '';
        this.id = id || '';
        this.expressionParser = expressionParser || new ExpressionParser();
        this.importResolver = importResolverDelegate;
        this.options = options || [];
        this.injectToExpressionFunction();
    }

    /**
     * Returns a new iterator for the template collection.
     */
    public [Symbol.iterator](): Iterator<Template> {
        let index = 0;
        return {
            next: (): IteratorResult<Template> => {
                if (index < this.items.length) {
                    return { done: false, value: this.items[index++] };
                } else {
                    return { done: true, value: undefined };
                }
            }
        };
    }

    /**
     * Returns a reference to the internal list of collection templates.
     */
    public toArray(): Template[] {
        return this.items;
    }

    /**
     * Appends 1 or more templates to the collection.
     * @param args List of templates to add.
     */
    public push(...args: Template[]): void {
        args.forEach(t => this.items.push(t));
    }

    /**
     * A value indicating whether the options when evaluation LG templates.
     */
    public get lgOptions(): EvaluationOptions {
        return new EvaluationOptions(this.options);
    }

    /**
     * A string value represents the namespace to register for current LG file.
     */
    public get namespace(): string {
        return this.extractNamespace(this.options);
    }

    /**
     * All templates from current lg file and reference lg files.
     */
    public get allTemplates(): Template[] {
        let result = this.items;
        this.references.forEach((ref): Template[] => result = result.concat(ref.items));
        return Array.from(new Set(result));
    }

    /**
     * All diagnostics from current lg file and reference lg files.
     */
    public get allDiagnostics(): Diagnostic[] {
        let result = this.diagnostics;
        this.references.forEach((ref): Diagnostic[] => result = result.concat(ref.diagnostics));
        return Array.from(new Set(result));
    }


    /**
    * parse a file and return LG file.
    * @param filePath LG absolute file path..
    * @param importResolver Resolver to resolve LG import id to template text.
    * @param expressionParser Expression parser for evaluating expressions.
    * @returns New lg file.
    */
    public static parseFile(filePath: string, importResolver?: ImportResolverDelegate, expressionParser?: ExpressionParser): Templates {
        return TemplatesParser.parseFile(filePath, importResolver, expressionParser).injectToExpressionFunction();
    }

    /**
     * Parser to turn lg content into a Templates.
     * @param content Text content contains lg templates.
     * @param id Id is the identifier of content. If importResolver is undefined, id must be a full path string. 
     * @param importResolver Resolver to resolve LG import id to template text.
     * @param expressionParser Expression parser for evaluating expressions.
     * @returns Entity.
     */
    public static parseText(content: string, id: string = '', importResolver?: ImportResolverDelegate, expressionParser?: ExpressionParser): Templates {
        return TemplatesParser.parseText(content, id, importResolver, expressionParser).injectToExpressionFunction();
    }

    /**
     * Evaluate a template with given name and scope.
     * @param templateName Template name to be evaluated.
     * @param scope The state visible in the evaluation.
     * @returns Evaluate result.
     */
    public evaluate(templateName: string, scope?: object, opt: EvaluationOptions = undefined): any {
        this.checkErrors();

        var evalOpt = opt !== undefined ? opt.merge(this.lgOptions) : this.lgOptions;
        const evaluator = new Evaluator(this.allTemplates, this.expressionParser, evalOpt);
        let result =  evaluator.evaluateTemplate(templateName, scope);
        if (evalOpt.LineBreakStyle === LGLineBreakStyle.Markdown && typeof result === 'string') {
            result = result.replace(this.newLineRegex, '$1$1');
        }

        return result;
    }

    /**
     * Expand a template with given name and scope.
     * Return all possible responses instead of random one.
     * @param templateName Template name to be evaluated.
     * @param scope The state visible in the evaluation.
     * @returns Expand result.
     */
    public expandTemplate(templateName: string, scope?: object, opt: EvaluationOptions = undefined): any[] {
        this.checkErrors();

        var evalOpt = opt !== undefined ? opt.merge(this.lgOptions) : this.lgOptions;
        const expander = new Expander(this.allTemplates, this.expressionParser, evalOpt);
        return expander.expandTemplate(templateName, scope);
    }

    /**
     * Analyze a template to get the static analyzer results including variables and template references.
     * @param templateName Template name to be evaluated.
     * @returns Analyzer result.
     */
    public analyzeTemplate(templateName: string): AnalyzerResult {
        this.checkErrors();

        const analyzer = new Analyzer(this.allTemplates, this.expressionParser);
        return analyzer.analyzeTemplate(templateName);
    }

    /**
     * Use to evaluate an inline template str.
     * @param inlineStr Inline string which will be evaluated.
     * @param scope Scope object or JToken.
     */
    public evaluateText(inlineStr: string, scope?: object,  opt: EvaluationOptions = undefined): any {
        if (inlineStr === undefined) {
            throw Error('inline string is empty');
        }

        this.checkErrors();

        // wrap inline string with "# name and -" to align the evaluation process
        const fakeTemplateId = '__temp__';
        const multiLineMark = '```';

        inlineStr = !(inlineStr.trim().startsWith(multiLineMark) && inlineStr.includes('\n'))
            ? `${ multiLineMark }${ inlineStr }${ multiLineMark }` : inlineStr;

        const newContent = `#${ fakeTemplateId } ${ this.newLine } - ${ inlineStr }`;

        const newTemplates = TemplatesParser.parseTextWithRef(newContent, this);
        var evalOpt = opt !== undefined ? opt.merge(this.lgOptions) : this.lgOptions;
        return newTemplates.evaluate(fakeTemplateId, scope, evalOpt);
    }

    /**
    * Update a template and return LG file.
    * @param templateName Orignial template name.
    * @param newTemplateName New template name.
    * @param parameters New params.
    * @param templateBody New template body.
    * @returns New lg file.
    */
    public updateTemplate(templateName: string, newTemplateName: string, parameters: string[], templateBody: string): Templates {
        const template: Template = this.items.find((u: Template): boolean => u.name === templateName);
        if (template === undefined) {
            return this;
        }

        const templateNameLine: string = this.buildTemplateNameLine(newTemplateName, parameters);
        const newTemplateBody: string = this.convertTemplateBody(templateBody);
        const content = `${ templateNameLine }${ this.newLine }${ newTemplateBody }`;

        let startLine = template.sourceRange.range.start.line - 1;
        let stopLine = template.sourceRange.range.end.line - 1;

        const newContent: string = this.replaceRangeContent(this.content, startLine, stopLine, content);
        this.initialize(TemplatesParser.parseText(newContent, this.id, this.importResolver));

        return this;
    }

    /**
    * Add a new template and return LG file.
    * @param templateName New template name.
    * @param parameters New params.
    * @param templateBody New  template body.
    * @returns New lg file.
    */
    public addTemplate(templateName: string, parameters: string[], templateBody: string): Templates {
        const template: Template = this.items.find((u: Template): boolean => u.name === templateName);
        if (template !== undefined) {
            throw new Error(TemplateErrors.templateExist(templateName));
        }

        const templateNameLine: string = this.buildTemplateNameLine(templateName, parameters);
        const newTemplateBody: string = this.convertTemplateBody(templateBody);
        const newContent = `${ this.content }${ this.newLine }${ templateNameLine }${ this.newLine }${ newTemplateBody }`;
        this.initialize(TemplatesParser.parseText(newContent, this.id, this.importResolver));

        return this;
    }

    /**
    * Delete an exist template.
    * @param templateName Which template should delete.
    * @returns Return the new lg file.
    */
    public deleteTemplate(templateName: string): Templates {
        const template: Template = this.items.find((u: Template): boolean => u.name === templateName);
        if (template === undefined) {
            return this;
        }

        let startLine = template.sourceRange.range.start.line - 1;
        let stopLine = template.sourceRange.range.end.line - 1;

        const newContent: string = this.replaceRangeContent(this.content, startLine, stopLine, undefined);
        this.initialize(TemplatesParser.parseText(newContent, this.id, this.importResolver));

        return this;
    }

    public toString(): string {
        return this.content;
    }

    private replaceRangeContent(originString: string, startLine: number, stopLine: number, replaceString: string): string {
        const originList: string[] = TemplateExtensions.readLine(originString);
        if (startLine < 0 || startLine > stopLine || stopLine >= originList.length) {
            throw new Error('index out of range.');
        }

        const destList: string[] = [];
        destList.push(...originList.slice(0, startLine));
        destList.push(replaceString);
        destList.push(...originList.slice(stopLine + 1));

        return destList.join(this.newLine);
    }

    private convertTemplateBody(templateBody: string): string {
        if (!templateBody) {
            return '';
        }

        const replaceList: string[] = TemplateExtensions.readLine(templateBody);
        const destList: string[] = replaceList.map((u: string): string => {
            return u.trimLeft().startsWith('#') ? `- ${ u.trimLeft() }` : u;
        });

        return destList.join(this.newLine);
    }

    private buildTemplateNameLine(templateName: string, parameters: string[]): string {
        // if parameters is null or undefined, ignore ()
        if (parameters === undefined || parameters === undefined) {
            return `# ${ templateName }`;
        } else {
            return `# ${ templateName }(${ parameters.join(', ') })`;
        }
    }

    private initialize(templates: Templates): void {
        this.items = templates.items;
        this.imports = templates.imports;
        this.diagnostics = templates.diagnostics;
        this.references = templates.references;
        this.content = templates.content;
        this.importResolver = templates.importResolver;
        this.id = templates.id;
        this.expressionParser = templates.expressionParser;
        this.options = templates.options;
    }

    private checkErrors(): void {
        if (this.allDiagnostics) {
            const errors = this.allDiagnostics.filter((u): boolean => u.severity === DiagnosticSeverity.Error);
            if (errors.length !== 0) {
                throw Error(errors.join(this.newLine));
            }
        }
    }

    private injectToExpressionFunction(): Templates {
        const totalTemplates =  [ this as Templates].concat(this.references);
        for (const curTemplates of totalTemplates) {
            const globalFuncs = curTemplates.getGlobalFunctionTable(curTemplates.options);
            for (const templateName of globalFuncs) {
                if (curTemplates.items.find(u => u.name === templateName) !== undefined) {
                    const newGlobalName = `${ curTemplates.namespace }.${ templateName }`;
                    Expression.functions.add(newGlobalName, new ExpressionEvaluator(newGlobalName, ExpressionFunctions.apply(this.globalTemplateFunction(templateName)), ReturnType.Object));
                }
            }
        }
        return this;
    }

    private extractOptionByKey(nameOfKey: string, options: string[]): string {
        let result: string = undefined;
        for (const option of options) {
            if (nameOfKey && option.includes('=')) {
                const index = option.indexOf('=');
                const key = option.substring(0, index).trim().toLowerCase();
                const value = option.substring(index + 1).trim();
                if (key === nameOfKey) {
                    result = value;
                }
            }
        }

        return result;
    }

    private extractNamespace(options: string[]): string {
        let result = this.extractOptionByKey(this.namespaceKey, options);
        if(!result) {
            if (isAbsolute(this.id)) {
                result = basename(this.id).split('.')[0];
            } else {
                throw new Error('namespace is required or the id should be an absoulte path!"');
            }
        }

        return result;
    }

    private getGlobalFunctionTable(options: string[]): string[] {
        const result: string[] = [];
        const value = this.extractOptionByKey(this.exportsKey, options);
        if (value) {
            const templateList = value.split(',');
            templateList.forEach(u => {
                result.push(u.trim());
            });
        }

        return result;
    }

    private readonly globalTemplateFunction = (templateName: string) => (args: any[]): any => {
        const evaluator = new Evaluator(this.allTemplates, this.expressionParser, this.lgOptions);
        const newScope: any = evaluator.constructScope(templateName, args);

        return evaluator.evaluateTemplate(templateName, newScope);
    }
}