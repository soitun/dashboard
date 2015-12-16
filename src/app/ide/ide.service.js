/*
 * Copyright (c) 2015 Codenvy, S.A.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *
 * Contributors:
 *   Codenvy, S.A. - initial API and implementation
 */
'use strict';

/**
 * This class is handling the service for viewing the IDE
 * @author Florent Benoit
 */
class IdeSvc {

    /**
     * Default constructor that is using resource
     * @ngInject for Dependency injection
     */
    constructor (codenvyAPI, $rootScope, $mdDialog, userDashboardConfig, $timeout, $websocket, $sce, proxySettings, ideLoaderSvc) {
        this.codenvyAPI = codenvyAPI;
        this.$rootScope = $rootScope;
        this.$mdDialog = $mdDialog;
        this.$timeout = $timeout;
        this.$websocket = $websocket;
        this.userDashboardConfig = userDashboardConfig;
        this.$sce = $sce;
        this.proxySettings = proxySettings;
        this.ideLoaderSvc = ideLoaderSvc;

        this.currentStep = 0;
        this.selectedWorkspace = null;

        this.steps = [
            {text: 'Initialize', logs: '', hasError: false},
            {text: 'Start workspace', logs: '', hasError: false},
            {text: 'Inject workspace agent', logs: '', hasError: false},
            {text: 'View IDE', logs: '', hasError: false}
        ];
    }

    displayIDE() {
        this.$rootScope.showIDE = true;
    }


    setSelectedWorkspace(selectedWorkspace) {
        this.selectedWorkspace = selectedWorkspace;
    }


    startIde() {
        this.ideLoaderSvc.addLoader();

        this.currentStep = 1;

        // recipe url
        let bus = this.codenvyAPI.getWebsocket().getBus(this.selectedWorkspace.id);

        // subscribe to workspace events
        bus.subscribe('workspace:' + this.selectedWorkspace.id, (message) => {

            if (message.eventType === 'RUNNING' && message.workspaceId === this.selectedWorkspace.id) {

                // Now that the container is started, wait for the extension server. For this, needs to get runtime details
                let promiseRuntime = this.codenvyAPI.getWorkspace().getRuntime(this.selectedWorkspace.id);
                promiseRuntime.then((runtimeData) => {
                    // extract the Websocket URL of the runtime
                    let servers = runtimeData.devMachine.metadata.servers;

                    var extensionServerAddress;
                    for (var key in servers) {
                        let server = servers[key];
                        if ('extensions' === server.ref) {
                            extensionServerAddress = server.address;
                        }
                    }

                    let endpoint = runtimeData.devMachine.metadata.envVariables.CHE_API_ENDPOINT;

                    var contextPath;
                    if (endpoint.endsWith('/che/api')) {
                        contextPath = 'che';
                    } else {
                        contextPath = 'api';
                    }

                    // try to connect
                    this.websocketReconnect = 50;
                    this.connectToExtensionServer('ws://' + extensionServerAddress + '/' + contextPath + '/ext/ws/' + this.selectedWorkspace.id, this.selectedWorkspace.id);

                });
            }
        });
        this.$timeout(() => {this.startWorkspace(bus, this.selectedWorkspace);}, 1000);

    }


    startWorkspace(bus, data) {

        let startWorkspacePromise = this.codenvyAPI.getWorkspace().startWorkspace(data.id, data.name);

        startWorkspacePromise.then((data) => {
            // get channels
            let environments = data.environments;
            let envName = data.name;
            let channels = environments[envName].machineConfigs[0].channels;
            let statusChannel = channels.status;
            let outputChannel = channels.output;


            let workspaceId = data.id;

            // for now, display log of status channel in case of errors
            bus.subscribe(statusChannel, (message) => {
                if (message.eventType === 'DESTROYED' && message.workspaceId === data.id) {
                    this.getCreationSteps()[this.getCurrentProgressStep()].hasError = true;

                    // need to show the error
                    this.$mdDialog.show(
                        this.$mdDialog.alert()
                            .title('Unable to start workspace')
                            .content('Unable to start workspace. It may be linked to OutOfMemory or the container has been destroyed')
                            .ariaLabel('Workspace start')
                            .ok('OK')
                    );
                }
                if (message.eventType === 'ERROR' && message.workspaceId === data.id) {
                    this.getCreationSteps()[this.getCurrentProgressStep()].hasError = true;
                    // need to show the error
                    this.$mdDialog.show(
                        this.$mdDialog.alert()
                            .title('Error when starting workspace')
                            .content('Unable to start workspace. Error when trying to start the workspace: ' + message.error)
                            .ariaLabel('Workspace start')
                            .ok('OK')
                    );
                }
                console.log('Status channel of workspaceID', workspaceId, message);
            });



            bus.subscribe(outputChannel, (message) => {
                if (this.steps[this.currentStep].logs.length > 0) {
                    this.steps[this.currentStep].logs = this.steps[this.currentStep].logs + '\n' + message;
                } else {
                    this.steps[this.currentStep].logs = message;
                }
            });

        });
    }


    connectToExtensionServer(websocketURL, workspaceId) {
        this.currentStep = 2;
        // try to connect
        let websocketStream = this.$websocket(websocketURL);

        // on success, create project
        websocketStream.onOpen(() => {
            this.openIde();

        });

        // on error, retry to connect or after a delay, abort
        websocketStream.onError((error) => {
            this.websocketReconnect--;
            if (this.websocketReconnect > 0) {
                this.$timeout(() => {this.connectToExtensionServer(websocketURL, workspaceId);}, 1000);
            } else {
                this.getCreationSteps()[this.getCurrentProgressStep()].hasError = true;
                console.log('error when starting remote extension', error);
                // need to show the error
                this.$mdDialog.show(
                    this.$mdDialog.alert()
                        .title('Unable to create project')
                        .content('Unable to connect to the remote extension server after workspace creation')
                        .ariaLabel('Project creation')
                        .ok('OK')
                );
            }
        });
    }

    openIde(skipLoader) {
        if (skipLoader) {
            this.ideLoaderSvc.addLoader();
            this.$rootScope.hideIdeLoader = true;
        }

        this.currentStep = 3;
        let inDevMode = this.userDashboardConfig.developmentMode;
        let randVal = Math.floor((Math.random()*1000000)+1);
        let rand = '?uid=' + randVal;

        if (inDevMode) {
            this.$rootScope.ideIframeLink = this.$sce.trustAsResourceUrl(this.proxySettings + '/che/' + this.selectedWorkspace.name + rand);
        } else {
            this.$rootScope.ideIframeLink = '/che/' + this.selectedWorkspace.name + rand;
        }
        if (!skipLoader) {
            this.$timeout(() => {
                this.$rootScope.hideIdeLoader = true;
            }, 4000);
        }

        this.$timeout(() => {
            this.$rootScope.showIDE = true;
            this.$rootScope.hideLoader = true;
            this.$rootScope.loadingIDE = false;


        }, 2000);


    }

}

export default IdeSvc;
