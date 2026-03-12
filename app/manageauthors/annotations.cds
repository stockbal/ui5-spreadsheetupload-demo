using AuthorsService as service from '../../srv/authors-service';

annotate service.Authors with @( //
    UI.LineItem           : [
        {Value: firstName},
        {Value: lastName}
    ],
    UI.FieldGroup #General: {Data: [
        {Value: firstName},
        {Value: lastName}
    ]},
    UI.Facets             : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'General',
        Target: '@UI.FieldGroup#General',
    }, ]
);
