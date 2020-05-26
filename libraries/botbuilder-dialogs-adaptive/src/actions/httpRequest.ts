/**
 * @module botbuilder-dialogs-adaptive
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import fetch from 'node-fetch';
import { DialogTurnResult, DialogConfiguration, DialogContext, Dialog, Configurable } from 'botbuilder-dialogs';
import { Activity } from 'botbuilder-core';
import { ExpressionParser } from 'adaptive-expressions';
import { TextTemplate } from '../templates';
import { ValueExpression, StringExpression, BoolExpression, EnumExpression } from 'adaptive-expressions';

export interface HttpRequestConfiguration extends DialogConfiguration {
    method?: HttpMethod;
    contentType?: string;
    url?: string;
    headers?: { [key: string]: string };
    body?: any;
    responseType?: string | ResponsesTypes;
    resultProperty?: string;
    disabled?: string | boolean;
}

export enum ResponsesTypes {
    /**
     * No response expected
     */
    None,

    /**
     * Plain JSON response
     */
    Json,

    /**
     * JSON Activity object to send to the user
     */
    Activity,

    /**
     * Json Array of activity objects to send to the user
     */
    Activities
}

export enum HttpMethod {
    /**
     * Http GET
     */
    GET = 'GET',

    /**
     * Http POST
     */
    POST = 'POST',

    /**
     * Http PATCH
     */
    PATCH = 'PATCH',

    /**
     * Http PUT
     */
    PUT = 'PUT',

    /**
     * Http DELETE
     */
    DELETE = 'DELETE'
}

export class HttpRequest<O extends object = {}> extends Dialog<O> implements Configurable {
    public constructor();
    public constructor(method: HttpMethod, url: string, headers: { [key: string]: string }, body: any);
    public constructor(method?: HttpMethod, url?: string, headers?: { [key: string]: string }, body?: any) {
        super();
        this.method = method || HttpMethod.GET;
        this.url = new StringExpression(url);
        if (headers) {
            this.headers = {};
            for (const key in headers) {
                this.headers[key] = new StringExpression(headers[key]);
            }
        }
        this.body = new ValueExpression(body);
    }

    /**
     * Http Method
     */
    public method?: HttpMethod = HttpMethod.GET;

    /**
     * Content type of request body
     */
    public contentType?: StringExpression = new StringExpression('application/json');

    /**
     * Http Url
     */
    public url?: StringExpression;

    /**
     * Http Headers
     */
    public headers?: { [key: string]: StringExpression } = {};
    /**
     * Http Body
     */
    public body?: ValueExpression;

    /**
     * The response type of the response
     */
    public responseType?: EnumExpression<ResponsesTypes> = new EnumExpression<ResponsesTypes>(ResponsesTypes.Json);

    /**
     * Gets or sets the property expression to store the HTTP response in.
     */
    public resultProperty?: StringExpression;

    /**
     * An optional expression which if is true will disable this action.
     */
    public disabled?: BoolExpression;

    public configure(config: HttpRequestConfiguration): this {
        for (const key in config) {
            if (config.hasOwnProperty(key)) {
                const value = config[key];
                switch (key) {
                    case 'contentType':
                        this.contentType = new StringExpression(value);
                        break;
                    case 'url':
                        this.url = new StringExpression(value);
                        break;
                    case 'headers':
                        this.headers = {};
                        for (const key in value) {
                            this.headers[key] = new StringExpression(value[key]);
                        }
                        break;
                    case 'body':
                        this.body = new ValueExpression(value);
                        break;
                    case 'responseType':
                        this.responseType = new EnumExpression<ResponsesTypes>(value);
                        break;
                    case 'resultProperty':
                        this.resultProperty = new StringExpression(value);
                        break;
                    case 'disabled':
                        this.disabled = new BoolExpression(value);
                        break;
                    default:
                        super.configure({ [key]: value });
                        break;
                }
            }
        }

        return this;
    }

    public async beginDialog(dc: DialogContext, options?: O): Promise<DialogTurnResult> {
        if (this.disabled && this.disabled.getValue(dc.state)) {
            return await dc.endDialog();
        }

        /**
         * TODO: replace the key value pair in json recursively
         */

        const instanceUrl = this.url.getValue(dc.state);
        const instanceHeaders = {};
        for (const key in this.headers) {
            instanceHeaders[key] = this.headers[key].getValue(dc.state);
        }

        let instanceBody: any;
        if (this.body) {
            instanceBody = this.body.getValue(dc.state);
        }

        if (instanceBody) {
            instanceBody = await this.replaceBodyRecursively(dc, instanceBody);
        }

        const parsedBody = JSON.stringify(instanceBody);
        const contentType = this.contentType.getValue(dc.state) || 'application/json';
        const parsedHeaders = Object.assign({ 'Content-Type': contentType }, instanceHeaders);

        let response: any;

        switch (this.method) {
            case HttpMethod.DELETE:
            case HttpMethod.GET:
                response = await fetch(instanceUrl, {
                    method: this.method.toString(),
                    headers: parsedHeaders,
                });
                break;
            case HttpMethod.PUT:
            case HttpMethod.PATCH:
            case HttpMethod.POST:
                response = await fetch(instanceUrl, {
                    method: this.method.toString(),
                    headers: parsedHeaders,
                    body: parsedBody,
                });
                break;
        }

        const jsonResult = await response.json();

        let result: Result = {
            headers: instanceHeaders,
            statusCode: response.status,
            reasonPhrase: response.statusText
        };

        switch (this.responseType.getValue(dc.state)) {
            case ResponsesTypes.Activity:
                result.content = jsonResult;
                dc.context.sendActivity(jsonResult as Activity);
                break;
            case ResponsesTypes.Activities:
                result.content = jsonResult;
                dc.context.sendActivities(jsonResult as Activity[]);
                break;
            case ResponsesTypes.Json:
                result.content = jsonResult;
                break;
            case ResponsesTypes.None:
            default:
                break;
        }

        if (this.resultProperty) {
            dc.state.setValue(this.resultProperty.getValue(dc.state), result);
        }

        return await dc.endDialog(result);
    }

    protected onComputeId(): string {
        return `HttpRequest[${ this.method } ${ this.url }]`;
    }

    private async replaceBodyRecursively(dc: DialogContext, unit: object): Promise<any> {
        if (typeof unit === 'string') {
            let text: string = unit as string;
            if (text.startsWith('{') && text.endsWith('}')) {
                text = text.slice(1, text.length - 1);
                const { value } = new ExpressionParser().parse(text).tryEvaluate(dc.state);
                return value;
            }
            else {
                return await new TextTemplate(text).bindToData(dc.context, dc.state);
            }
        }

        if (Array.isArray(unit)) {
            let result = [];
            for (const child of unit) {
                result.push(await this.replaceBodyRecursively(dc, child));
            }

            return result;
        }

        if (typeof unit === 'object') {
            let result = {};
            for (let key in unit) {
                result[key] = await this.replaceBodyRecursively(dc, unit[key]);
            }
            return result;
        }

        return unit;
    }
}

export class Result {
    public statusCode?: Number;

    public reasonPhrase?: string;

    public headers?: any;

    public content?: object;
}