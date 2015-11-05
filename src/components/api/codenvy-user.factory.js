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

import Register from '../utils/register.js';

/**
 * This class is handling the user API retrieval
 * @author Florent Benoit
 */
class CodenvyUser {

  /**
   * Default constructor that is using resource
   * @ngInject for Dependency injection
   */
  constructor($resource, $q) {

    // keep resource
    this.$resource = $resource;
    this.$q = $q;

    // remote call
    this.remoteUserAPI = this.$resource('/api/user', {}, {
      findByID: {method: 'GET', url: '/api/user/:userId'},
      findByEmail: {method: 'GET', url: '/api/user/find?email=:userEmail'},
      inRole: {method: 'GET', url: '/api/user/inrole?role=:role&scope=:scope&scopeId=:scopeId'},
      setPassword: {
        method: 'POST', url: '/api/user/password', isArray: false,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        }
      }
    });

    // users by ID
    this.useridMap = new Map();

    // users by email
    this.userEmailMap = new Map();

    // user roles
    this.isUserInRoleMap = new Map();

    // fetch the user when we're initialized
    this.fetchUser();

    this.isLogged = false;

    this.userPromise = null;

  }


  /**
   * Gets the user ID
   * @return user ID
   */
  getUser() {
    // try to refresh if user is not yet logged in
    if (!this.isLogged) {
      this.fetchUser();
    }
    return this.user;
  }

  /**
   * Gets the user data
   */
  refetchUser() {
    return this.fetchUser(true);
  }

  /**
   * Gets the user data
   */
  fetchUser(ignoreCache) {
    if (!ignoreCache && this.userPromise) {
      return this.userPromise;
    }
    // check user or not
    let isUserPromise = this.fetchIsUserInRole('user', 'system', '');
    // check admin or not
    let isAdminPromise = this.fetchIsUserInRole('admin', 'system', '');

    let deferred = this.$q.defer();

    isUserPromise.then(() => {
      if (this.isUser()) {
        //if user
        this.user = this.remoteUserAPI.get();
        // check if if was OK or not
        this.user.$promise.then(() => {
          this.isLogged = true;
          deferred.resolve();
        }, (error) => {
          this.isLogged = false;
          deferred.reject(error);
        });
      } else {
        isAdminPromise.then(() => {
          deferred.resolve();
          this.isLogged = true;
        }, (error) => {
          this.isLogged = false;
          deferred.reject(error);
        });
      }
    }, (error) => {
      this.isLogged = false;
      deferred.reject(error);
    });

    this.userPromise = this.$q.all([deferred.promise, isUserPromise, isAdminPromise]);

    return this.userPromise;
  }


  fetchUserId(userId) {
    let promise = this.remoteUserAPI.findByID({userId: userId}).$promise;
    let parsedResultPromise = promise.then((user) => {
      this.useridMap.set(userId, user);
    });

    return parsedResultPromise;

  }

  getUserFromId(userId) {
    return this.useridMap.get(userId);
  }

  fetchUserEmail(userEmail) {
    let promise = this.remoteUserAPI.findByEmail({userEmail: userEmail}).$promise;
    let parsedResultPromise = promise.then((user) => {
      this.useridMap.set(user.id, user);
      this.userEmailMap.set(userEmail, user);
    });

    return parsedResultPromise;

  }

  getUserFromEmail(userEmail) {
    return this.userEmailMap.get(userEmail);
  }

  setPassword(password) {
    return this.remoteUserAPI.setPassword('password=' + password).$promise;
  }

  fetchIsUserInRole(role, scope, scopeId) {
    let promise = this.remoteUserAPI.inRole({role: role, scope: scope, scopeId: scopeId}).$promise;

    let deferred = this.$q.defer();

    promise.then((userInRole) => {
      this.isUserInRoleMap.set(scope + '/' + role + ':' + scopeId, userInRole);
      deferred.resolve();
    }, (error) => {
      deferred.reject(error);
    });

    return deferred.promise;
  }

  /**
   * Check if useris admin or not by checking the system admin role
   * @returns {*}
   */
  isAdmin() {
    let userInRole = this.isUserInRoleMap.get('system/admin:');
    return userInRole && userInRole.isInRole;
  }

  /**
   * Check if user is user or not by checking the user role
   * @returns {*}
   */
  isUser() {
    let userInRole = this.isUserInRoleMap.get('system/user:');
    return userInRole && userInRole.isInRole;
  }


  /**
   * Forms the string to display from list of roles.
   * @returns {String}
   */
  getDisplayRole(roles) {
    let str = '';

    roles.forEach((role) => {
      let parts = role.split('/');
      str += parts && parts.length > 1 ? parts[1] : role;
      str += ' ';
    });

    return str;
  }

}

// Register this factory
Register.getInstance().factory('codenvyUser', CodenvyUser);
