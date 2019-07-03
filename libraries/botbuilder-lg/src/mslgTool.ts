/**
 * @module botbuilder-expression-lg
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { Analyzer } from './analyzer';
import { Diagnostic, Position, Range } from './diagnostic';
import { Expander, IGetMethod } from './expander';
import { Extractor } from './extractor';
import { LGParser } from './lgParser';
import { LGTemplate } from './lgTemplate';
import { StaticChecker } from './staticChecker';

// tslint:disable-next-line: completed-docs
export class MSLGTool {
    public CollationMessages: string[] = [];
    public CollatedTemplates: Map<string, any> = new Map<string, any>();
    public NameCollisions: string[] = [];

    private Templates: LGTemplate[];

    public ValidateFile(lgFileContent: string): string[] {
        let errors: string[] = [];

        const parseResult: { isValid: boolean; templates: LGTemplate[]; error: Diagnostic } = LGParser.TryParse(lgFileContent);
        if (parseResult.isValid) {
            this.Templates = parseResult.templates;
            if (this.Templates !== undefined && this.Templates.length > 0) {
                // run static checker to get warning messages
                errors = this.RunStaticCheck(this.Templates);
                if (errors === undefined || errors.length === 0) {
                    this.RunTemplateExtractor(this.Templates);
                }
            }
        } else {
            const start: Position = parseResult.error.Range.Start;
            const end: Position = parseResult.error.Range.End;
            const error: Diagnostic = new Diagnostic(
                new Range(
                    new Position(start.Line, start.Character),
                    new Position(end.Line, end.Character)),
                parseResult.error.Message,
                parseResult.error.Severity);

            console.log(error.toString());
            errors = errors.concat(error.toString());
        }

        return errors;
    }

    public GetTemplateVariables(templateName: string): string[] {
        const analyzer: Analyzer = new Analyzer(this.Templates);

        return analyzer.AnalyzeTemplate(templateName).Variables;
    }

    public ExpandTemplate(templateName: string, scope: any, methodBinder?: IGetMethod): string[] {
        const expander: Expander = new Expander(this.Templates, methodBinder);

        return expander.ExpandTemplate(templateName, scope);
    }

    public CollateTemplates(): string {
        let result: string = '';
        if (this.CollationMessages === undefined || this.CollationMessages.length === 0) {
            for (const template of this.CollatedTemplates) {
                result += '# ' + template[0] + '\n';
                if (template[1] instanceof Array) {
                    (template[1] as string[]).forEach(templateStr => {
                        result += templateStr.slice(0, 1) + ' ' + templateStr.slice(1) + '\n';
                    });
                } else if (template[1] instanceof Map) {
                    for (const condition of (template[1] as Map<string, string[]>)) {
                        const conditionStr = condition[0];
                        result += '- ' + conditionStr + '\n';
                        condition[1].forEach(templateStr => {
                            result += '   ' + templateStr.slice(0, 1) + ' ' + templateStr.slice(1) + '\n';
                        });
                    }
                } else {
                    return undefined;
                }

                result += '\n';
            }
        }

        return result;
    }

    // tslint:disable-next-line: max-line-length
    private RunStaticCheck(templates: LGTemplate[]): string[] {
        const checker: StaticChecker = new StaticChecker(templates);

        return checker.Check().map((error: Diagnostic) => error.toString());
    }

    private RunTemplateExtractor(lgtemplates: LGTemplate[]): void {
        const extractor: Extractor = new Extractor(lgtemplates);
        const templates: Map<string, any>[] = extractor.Extract();
        for (const item of templates) {
            const template: any = item.entries().next().value;
            if (this.CollatedTemplates.has(template[0])) {
                this.NameCollisions.push(template[0]);
                if (this.CollatedTemplates.get(template[0]) instanceof Map && template[1] instanceof Map) {
                    for (const condition of (template[1] as Map<string, string[]>)) {
                        const mergedCondtions: Map<string, string[]>  = this.CollatedTemplates.get(template[0]) as Map<string, string[]>;
                        if (mergedCondtions.has(condition[0])) {
                            // tslint:disable-next-line: max-line-length
                            this.CollatedTemplates.set(template[0], this.CollatedTemplates.get(template[0]).set(condition[0], Array.from(new Set(mergedCondtions.get(condition[0]).concat(condition[1])))));
                        } else {
                            // tslint:disable-next-line: max-line-length
                            this.CollatedTemplates.set(template[0], this.CollatedTemplates.get(template[0]).set(condition[0], condition[1]));
                        }
                    }
                } else if (this.CollatedTemplates.get(template[0]) instanceof Array && template[1] instanceof Array) {
                    // tslint:disable-next-line: max-line-length
                    this.CollatedTemplates.set(template[0], Array.from(new Set(this.CollatedTemplates.get(template[0]).concat(template[1]))));
                } else {
                    const range: Range = new Range(new Position(0, 0), new Position(0, 0));
                    // tslint:disable-next-line: max-line-length
                    const mergeError: Diagnostic = new Diagnostic(range, `Template ${template[0]} occurred in both normal and condition templates`);
                    this.CollationMessages.push(mergeError.toString());
                }
            } else {
                this.CollatedTemplates.set(template[0], template[1]);
            }
        }
    }
}
