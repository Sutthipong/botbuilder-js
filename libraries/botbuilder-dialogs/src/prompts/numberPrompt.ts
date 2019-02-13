/**
 * @module botbuilder-dialogs
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Recognizers from '@microsoft/recognizers-text-number';
import { Activity, InputHints, TurnContext } from 'botbuilder-core';
import { Prompt, PromptOptions, PromptRecognizerResult, PromptValidator, PromptValidatorContext, PromptConfiguration } from './prompt';

/**
 * Prompts a user to enter a number.
 *
 * @remarks
 * By default the prompt will return to the calling dialog a `number` representing the users input.
 */
export class NumberPrompt extends Prompt<number> {

    /**
     * The prompts default locale that should be recognized.
     */
    public defaultLocale: string|undefined;

    /**
     * Creates a new NumberPrompt instance.
     * @param dialogId (Optional) unique ID of the dialog within its parent `DialogSet` or `ComponentDialog`.
     * @param validator (Optional) validator that will be called each time the user responds to the prompt.
     * @param defaultLocale (Optional) locale to use if `TurnContext.activity.locale` is not specified. Defaults to a value of `en-us`.
     */
    constructor(dialogId?: string, validator?: PromptValidator<number>, defaultLocale?: string) {
        super(dialogId, validator || defaultValidator);
        this.defaultLocale = defaultLocale;
    }

    protected onComputeID(): string {
        return `numberPrompt[${this.bindingPath()}]`;
    }

    protected async onPrompt(context: TurnContext, state: any, options: PromptOptions, isRetry: boolean): Promise<void> {
        if (isRetry && options.retryPrompt) {
            await context.sendActivity(options.retryPrompt, undefined, InputHints.ExpectingInput);
        } else if (options.prompt) {
            await context.sendActivity(options.prompt, undefined, InputHints.ExpectingInput);
        }
    }

    protected async onRecognize(context: TurnContext, state: any, options: PromptOptions): Promise<PromptRecognizerResult<number>> {
        const result: PromptRecognizerResult<number> = { succeeded: false };
        const activity: Activity = context.activity;
        const utterance: string = activity.text;
        const locale: string = activity.locale || this.defaultLocale || 'en-us';
        const results: any = Recognizers.recognizeNumber(utterance, locale);
        if (results.length > 0 && results[0].resolution) {
            result.succeeded = true;
            result.value = parseFloat(results[0].resolution.value);
        }

        return result;
    }

    public static create(propertyOrConfig: PromptConfiguration): NumberPrompt;
    public static create(propertyOrConfig: string, prompt: string|Partial<Activity>, config?: PromptConfiguration): NumberPrompt;
    public static create(propertyOrConfig: string|PromptConfiguration, prompt?: Partial<Activity>|string, config?: PromptConfiguration): NumberPrompt {
        const dialog = new NumberPrompt();
        if (typeof propertyOrConfig === 'string') {
            dialog.property = propertyOrConfig;
            dialog.prompt.value = prompt;
            if (config) { Prompt.configure(dialog, config) }
        } else {
            Prompt.configure(dialog, config);
        }
        return dialog;
    }
}


async function defaultValidator(prompt: PromptValidatorContext<number>): Promise<boolean> {
    return prompt.preValidation ? typeof prompt.recognized.value === 'number' : prompt.recognized.succeeded;
}