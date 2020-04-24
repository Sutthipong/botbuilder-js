/**
 * @module botbuilder-dialogs-adaptive
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { LanguageGenerator } from '../languageGenerator';
import { TurnContext } from 'botbuilder-core';
import { Templates } from 'botbuilder-lg';
import { IResource } from 'botbuilder-dialogs-declarative';
import { LanguageResourceLoader } from '../languageResourceLoader';
import { LanguageGeneratorManager } from './languageGeneratorManager';
import { normalize, basename } from 'path';

/**
 * LanguageGenerator implementation which uses LGFile. 
 */
export class TemplateEngineLanguageGenerator implements LanguageGenerator{
    public static declarative: string = 'Microsoft.TemplateEngMineLanguageGenerator';
    
    private readonly DEFAULTLABEL: string  = 'Unknown';

    private lg: Templates;

    public id: string = '';

    public constructor(arg1?: Templates | string, arg2?: string | Map<string,IResource[]>, arg3?: Map<string,IResource[]>) {
        if (arguments.length === 0) {
            this.lg = new Templates();
        } else if(arguments.length === 1 && arg1 instanceof Templates) {
            this.lg = arg1;
        } else if (arguments.length === 2 && typeof arg1 === 'string' && arg2 instanceof Map) {
            const filePath = normalize(arg1 as string);
            const resourceMapping = arg2 as  Map<string,IResource[]>;
            this.id = basename(filePath);
            const {prefix: _, language: locale} = LanguageResourceLoader.parseLGFileName(this.id);
            const importResolver = LanguageGeneratorManager.resourceExplorerResolver(locale, resourceMapping);
            this.lg = Templates.parseFile(filePath, importResolver);
        } else if (arguments.length === 3 && typeof arg1 === 'string' && typeof arg2 === 'string' && arg3 instanceof Map) {
            const id = arg2 as string;
            this.id = id !== undefined? id : this.DEFAULTLABEL;
            const {prefix: _, language: locale} = LanguageResourceLoader.parseLGFileName(arg2);
            const resourceMapping = arg3 as  Map<string,IResource[]>;
            const importResolver = LanguageGeneratorManager.resourceExplorerResolver(locale, resourceMapping);
            const lgText = arg1? arg1 : '';
            this.lg = Templates.parseText(lgText, id, importResolver);
        }
    }
    
    public generate(turnContext: TurnContext, template: string, data: object): Promise<string> {
        try {
            return Promise.resolve(this.lg.evaluateText(template, data).toString());
        } catch(e) {
            if (this.id !== undefined && this.id === '') {
                throw Error(`${ this.id }:${ e }`);
            }

            throw Error(e);
        }
    }
}