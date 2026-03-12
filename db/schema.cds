namespace my.bookshop;

using {cuid} from '@sap/cds/common';

entity Books {
    key ID     : Integer     @title: 'ID';
        title  : String(255) @title: 'Title';
        author : String(255) @title: 'Author';
}

@assert.unique: {unique: [
    firstName,
    lastName
]}
entity Authors : cuid {
    firstName : String(100) @title: 'First Name';
    lastName  : String(100) @title: 'Last Name';
}
