export const GET_SYNDICATE_DESCRIPTION = [
    'Open one syndicate by id — its card (name, manager, the four fee rates as percentages, member count,',
    'creation time) plus a page of its members. Members are returned in the registry order (joinedAt ascending,',
    'then address); page them with membersLimit/membersOffset. An unknown id is an error; a members page past',
    'the end is empty. Public read.',
].join(' ');
