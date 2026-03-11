using CatalogService as service from '../../srv/catalog-service';

annotate service.Books with @( //
    UI.LineItem           : [
        {Value: ID},
        {Value: title},
        {Value: author}
    ],
    UI.FieldGroup #General: {Data: [
        {Value: ID},
        {Value: title},
        {Value: author}
    ]},
    UI.Facets             : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'General',
        Target: '@UI.FieldGroup#General',
    }, ]
);
