import { apolloClient } from "@/plugins/vue-apollo";
import { RolesQuery, AllRoleIdsQuery } from "@/GraphQL/roles";
import throttle from "lodash/throttle";
import Vue from "vue";
import {
  CreateRoleMutation,
  UpdateRoleMutation,
  DeleteRoleMutation,
} from "../../GraphQL/roles";

export default {
  state: {
    roles: [],
    num_roles: 0,
    isLoadingRoles: true,
    paginationLimit: 20, // number of roles loaded at a time. More are loaded on scroll down.
    paginationOffset: 0,
    infiniteScrollIdentifier: false, // on change infinite scroll knows new roles were loaded
    selectedFilters: {},
  },
  getters: {
    getByID: state => id => state.roles.find(role => role.id == id),
    isNewQuery: state => state.paginationOffset == 0,
  },
  mutations: {
    addRole(state, newRole) {
      state.roles.unshift(newRole);
      state.num_roles++;
    },
    deleteRole(state, roleID) {
      const roleIndex = state.roles.findIndex(role => role.id === roleID);
      if (roleIndex > -1) {
        state.roles.splice(roleIndex, 1);
      }
      state.num_roles--;
    },
    addRoles(state, newRoles) {
      state.roles.push.apply(state.roles, newRoles);
      state.num_roles += newRoles.length;
    },
    editRole(state, newRole) {
      const roleIndex = state.roles.findIndex(role => role.id === newRole.id);
      state.roles[roleIndex] = newRole;
    },
    setRoles(state, roles) {
      state.roles = roles;
    },
    setRolesCount(state, num_roles) {
      state.num_roles = num_roles;
    },
    setLoadingState(state, isLoading) {
      state.isLoadingRoles = isLoading;
    },
    reloadRoles(state) {
      state.roles = [];
      state.paginationOffset = 0;
      state.infiniteScrollIdentifier = !state.infiniteScrollIdentifier;
    },
    nextPagination(state) {
      state.paginationOffset += state.paginationLimit;
    },
    setFilter(state, { filterType, filterValue }) {
      Vue.set(state.selectedFilters, filterType, filterValue);
    },
  },
  actions: {
    createRole: async function({ commit }, newRole) {
      if (!newRole) {
        console.error("NewRole not found");
        return;
      }

      await apolloClient.mutate({
        mutation: CreateRoleMutation,
        variables: { input: [newRole] },
        update: (
          store,
          {
            data: {
              insert_role: { returning },
            },
          }
        ) => {
          commit("addRole", returning[0]);
        },
      });
    },
    updateRole: async function({ commit }, newRole) {
      await apolloClient.mutate({
        mutation: UpdateRoleMutation,
        variables: { id: newRole.id, input: newRole },
        update: (
          store,
          {
            data: {
              update_role: { returning },
            },
          }
        ) => {
          commit("editRole", returning[0]);
        },
      });
    },
    deleteRole: async function({ commit }, roleID) {
      await apolloClient.mutate({
        mutation: DeleteRoleMutation,
        variables: { id: roleID },
        update: () => {
          commit("deleteRole", roleID);
        },
      });
    },
    loadRoles: throttle(async function(
      { state, getters, commit, rootState, rootGetters, dispatch },
      scrollState
    ) {
      commit("setLoadingState", true);
      // load group data if it doesn't exist yet. Necessary for the next block
      if (
        !rootState.groups.localGroups.length ||
        !rootState.groups.workingCircles.length
      ) {
        await dispatch("groups/loadGroups", {}, { root: true });
      }

      /* 
      When no local group is selected, we search roles from all local groups. Same for working circles.
      TODO: A better solution is to have reactive queries which remove the working group or local circle `where`
      filter from the query if none have been selected.
      */
      const localGroupIds = state.selectedFilters.localGroups.length
        ? state.selectedFilters.localGroups
        : rootGetters["groups/localGroupIds"];
      const workingCircleIds = state.selectedFilters.workingCircles.length
        ? state.selectedFilters.workingCircles
        : rootGetters["groups/workingCircleIds"];

      const response = await apolloClient.query({
        query: RolesQuery,
        variables: {
          limit: state.paginationLimit,
          offset: state.paginationOffset,
          localGroupIds: localGroupIds,
          workingCircleIds: workingCircleIds,
          timeCommitmentMin: state.selectedFilters.timeCommitment[0],
          timeCommitmentMax: state.selectedFilters.timeCommitment[1],
          search: `%${state.selectedFilters.search}%`,
        },
      });

      const newRoles = response.data.roles;

      if (getters.isNewQuery) {
        commit("setRoles", newRoles);
      } else {
        commit("addRoles", newRoles);
      }

      async function roleCount() {
        const response = await apolloClient.query({
          query: AllRoleIdsQuery,
        });
        return response.data.roles.length;
      }

      commit("setRolesCount", await roleCount());

      if (newRoles.length) {
        scrollState.loaded();
        commit("nextPagination");
        if (newRoles.length < state.paginationLimit) {
          scrollState.complete();
        }
      } else {
        scrollState.complete();
      }

      commit("setLoadingState", false);
    },
    500),
    setFilter({ commit }, payload) {
      commit("setFilter", payload);
      commit("reloadRoles");
    },
    setDefaultFilters({ commit, rootGetters }) {
      commit("setFilter", { filterType: "search", filterValue: "" });
      commit("setFilter", { filterType: "localGroups", filterValue: [] });
      commit("setFilter", { filterType: "workingCircles", filterValue: [] });
      commit("setFilter", {
        filterType: "timeCommitment",
        filterValue: [
          rootGetters["defaults/timeCommitmentRange"].min,
          rootGetters["defaults/timeCommitmentRange"].max,
        ],
      });

      commit("reloadRoles");
    },
  },
};
