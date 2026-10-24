// R1: classes, fields and class-level permissions, created by Parse Server at startup.
const publicRead = { find: { '*': true }, get: { '*': true }, count: { '*': true } };
const loggedIn = { requiresAuthentication: true };
const nobody = {};

const pointer = (targetClass) => ({ type: 'Pointer', targetClass });

// Post and Comment: anyone reads, only logged-in users write (the ACL then limits
// update/delete to the author).
const userContent = {
  ...publicRead,
  create: loggedIn,
  update: loggedIn,
  delete: loggedIn,
  addField: nobody,
};

module.exports = {
  lockSchemas: true,
  strict: true,
  definitions: [
    {
      className: '_User',
      classLevelPermissions: {
        ...publicRead,
        create: { '*': true }, // sign up
        update: loggedIn,
        delete: loggedIn,
        addField: nobody,
      },
    },
    {
      className: 'Post',
      fields: {
        title: { type: 'String' },
        body: { type: 'String' },
        author: pointer('_User'),
        likesCount: { type: 'Number' },
        commentsCount: { type: 'Number' },
      },
      classLevelPermissions: userContent,
    },
    {
      className: 'Comment',
      fields: {
        post: pointer('Post'),
        author: pointer('_User'),
        text: { type: 'String' },
      },
      classLevelPermissions: userContent,
    },
    {
      className: 'Like',
      fields: {
        post: pointer('Post'),
        user: pointer('_User'),
      },
      // Only Cloud Code (master key) can write likes.
      classLevelPermissions: { ...publicRead, create: nobody, update: nobody, delete: nobody, addField: nobody },
    },
  ],
};
