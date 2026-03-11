namespace my.bookshop;

entity Books {
    key ID     : Integer     @title: 'ID';
        title  : String(255) @title: 'Title';
        author : String(255) @title: 'Author';
}
